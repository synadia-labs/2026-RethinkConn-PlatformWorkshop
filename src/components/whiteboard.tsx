import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Pencil, Eraser, Trash2 } from 'lucide-react'
import type { NatsConnection } from '@nats-io/nats-core'
import { connectNats, ensureStream, rollupHeaders } from '#/lib/nats'
import { jetstream } from '@nats-io/jetstream'

interface Point {
  x: number
  y: number
}

interface DrawMessage {
  type: 'draw'
  id: string
  from: Point
  to: Point
  thickness: number
  color: string
}

interface ClearMessage {
  type: 'clear'
  id: string
}

type Message = DrawMessage | ClearMessage

const COLORS = ['#000000', '#ef4444', '#22c55e', '#3b82f6', '#ffffff']
const THICKNESSES = [5, 10, 15, 20]

export function Whiteboard({ id }: { id: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<Point>({ x: 0, y: 0 })
  const localIdRef = useRef(Math.random().toString(36).slice(2, 10))
  const ncRef = useRef<NatsConnection | null>(null)
  const readyRef = useRef(false)

  const [color, setColor] = useState(COLORS[0])
  const [thickness, setThickness] = useState(THICKNESSES[0])
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const colorRef = useRef(color)
  const thicknessRef = useRef(thickness)
  colorRef.current = color
  thicknessRef.current = thickness

  const subject = `whiteboard.${id}`
  const streamName = `whiteboard_${id}`

  const drawRaw = useCallback((msg: DrawMessage) => {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.beginPath()
    ctx.lineWidth = msg.thickness
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = msg.color
    ctx.moveTo(msg.from.x, msg.from.y)
    ctx.lineTo(msg.to.x, msg.to.y)
    ctx.stroke()
  }, [])

  const handleMessage = useCallback(
    (msg: Message) => {
      switch (msg.type) {
        case 'draw':
          if (msg.id !== localIdRef.current) {
            drawRaw(msg)
          }
          break
        case 'clear': {
          const canvas = canvasRef.current
          const ctx = ctxRef.current
          if (canvas && ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
          }
          break
        }
      }
    },
    [drawRaw],
  )

  useEffect(() => {
    let cancelled = false

    async function connect() {
      const { nc } = await connectNats()
      if (cancelled) {
        await nc.close()
        return
      }
      ncRef.current = nc
      setConnected(true)

      await ensureStream(nc, streamName, [`${subject}.>`])

      const js = jetstream(nc)
      const consumer = await js.consumers.get(streamName, {
        inactive_threshold: 10_000,
      })
      const info = await consumer.info()
      if (info.num_pending === 0) setReady(true)

      const sub = await consumer.consume()
      for await (const m of sub) {
        if (cancelled) break
        try {
          const data = m.json<Message>()
          handleMessage(data)
        } catch {
          // skip malformed messages
        }
        if (!readyRef.current && m.info.pending === 0) {
          setReady(true)
          readyRef.current = true
        }
      }
    }

    connect().catch((err) => {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to connect')
    })

    function onBeforeUnload() {
      ncRef.current?.close()
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      cancelled = true
      window.removeEventListener('beforeunload', onBeforeUnload)
      ncRef.current?.close()
      ncRef.current = null
      setConnected(false)
    }
  }, [id, subject, streamName, handleMessage])

  const publish = useCallback(
    (msg: Message) => {
      const nc = ncRef.current
      if (!nc) return
      try {
        const opts =
          msg.type === 'clear' ? { headers: rollupHeaders() } : undefined
        nc.publish(`${subject}.events`, JSON.stringify(msg), opts)
      } catch (err) {
        console.error('publish error:', err, 'payload size:', JSON.stringify(msg).length)
      }
    },
    [subject],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctxRef.current = ctx

    function resize() {
      if (!canvas || !ctx) return
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const parent = canvas.parentElement
      canvas.width = parent ? parent.clientWidth : window.innerWidth
      canvas.height = parent ? parent.clientHeight : window.innerHeight
      ctx.putImageData(imageData, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const getPoint = useCallback((e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }

    if ('touches' in e) {
      const rect = canvas.getBoundingClientRect()
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      }
    }
    return { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }
  }, [])

  const onPointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      drawingRef.current = true
      lastRef.current = getPoint(e)
    },
    [getPoint],
  )

  const onPointerUp = useCallback(() => {
    drawingRef.current = false
  }, [])

  const onPointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!drawingRef.current) return
      const from = lastRef.current
      const to = getPoint(e)
      const msg: DrawMessage = {
        type: 'draw',
        id: localIdRef.current,
        from,
        to,
        thickness: thicknessRef.current,
        color: colorRef.current,
      }
      drawRaw(msg)
      publish(msg)
      lastRef.current = to
    },
    [getPoint, drawRaw, publish],
  )

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
    publish({ type: 'clear', id: localIdRef.current })
  }, [publish])

  const toolbarBtnClass = (active: boolean) =>
    `flex items-center justify-center w-10 h-10 rounded transition-colors ${active ? 'bg-[var(--lagoon)] text-white' : 'text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'}`

  return (
    <div className="relative flex h-screen w-screen overflow-hidden">
      {!ready && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-neutral-200">
          {error ? (
            <>
              <p className="max-w-md text-center text-sm text-red-600">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="rounded bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
              >
                Retry
              </button>
              <Link to="/" className="text-sm text-neutral-500 hover:text-neutral-800">
                Back to whiteboards
              </Link>
            </>
          ) : (
            <>
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-300 border-t-neutral-700" />
              <p className="text-sm text-neutral-500">
                {connected ? 'Loading whiteboard...' : 'Connecting...'}
              </p>
            </>
          )}
        </div>
      )}

      <div className="z-10 flex w-12 flex-col items-center gap-1 bg-neutral-900 py-2">
        <Link
          to="/"
          className={toolbarBtnClass(false)}
        >
          <ArrowLeft size={18} />
        </Link>

        <div className="my-1 h-px w-6 bg-neutral-700" />

        <button className={toolbarBtnClass(true)} title="Draw">
          <Pencil size={18} />
        </button>

        <button onClick={clear} className={toolbarBtnClass(false)} title="Clear canvas">
          <Trash2 size={18} />
        </button>

        <button
          onClick={() => setColor('#ffffff')}
          className={toolbarBtnClass(color === '#ffffff')}
          title="Eraser"
        >
          <Eraser size={18} />
        </button>

        <div className="my-1 h-px w-6 bg-neutral-700" />

        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className="flex h-8 w-8 items-center justify-center"
            title={c}
          >
            <span
              className={`block h-5 w-5 rounded-full border-2 transition-transform ${color === c ? 'scale-110 border-white' : 'border-neutral-600'}`}
              style={{ background: c }}
            />
          </button>
        ))}

        <div className="my-1 h-px w-6 bg-neutral-700" />

        {THICKNESSES.map((n) => (
          <button
            key={n}
            onClick={() => setThickness(n)}
            className={`flex h-8 w-8 items-center justify-center ${thickness === n ? 'text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
            title={`${n}pt`}
          >
            <span
              className="block rounded-full bg-current"
              style={{ width: Math.max(n * 0.6, 4), height: Math.max(n * 0.6, 4) }}
            />
          </button>
        ))}
      </div>

      <div
        className="relative flex-1"
        style={{
          backgroundColor: '#ffffff',
          backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ cursor: 'crosshair' }}
          onMouseDown={onPointerDown}
          onMouseUp={onPointerUp}
          onMouseMove={onPointerMove}
          onTouchStart={onPointerDown}
          onTouchEnd={onPointerUp}
          onTouchMove={onPointerMove}
        />
      </div>
    </div>
  )
}
