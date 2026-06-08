import { useCallback, useEffect, useRef, useState } from 'react'

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

export function Whiteboard({ id: _id }: { id: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<Point>({ x: 0, y: 0 })
  const localIdRef = useRef(Math.random().toString(36).slice(2, 10))

  const [color, setColor] = useState(COLORS[0])
  const [thickness, setThickness] = useState(THICKNESSES[0])
  const colorRef = useRef(color)
  const thicknessRef = useRef(thickness)
  colorRef.current = color
  thicknessRef.current = thickness

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

  // TODO: wire up NATS subscription and call handleMessage for incoming messages
  void handleMessage

  const publish = useCallback((_msg: Message) => {
    // TODO: publish to NATS
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctxRef.current = ctx

    function resize() {
      if (!canvas) return
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
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

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <div className="absolute top-0 z-10 w-full">
        <div className="flex gap-3 p-4">
          <div className="flex gap-3 border-r border-slate-300 pr-4">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`block h-8 w-8 rounded-full border border-slate-300 transition-all hover:ring-2 ring-offset-1 ${color === c ? 'ring-2' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>

          <div className="flex gap-4 border-r border-slate-300 pr-4">
            <select
              className="bg-white"
              value={thickness}
              onChange={(e) => setThickness(Number(e.target.value))}
            >
              {THICKNESSES.map((n) => (
                <option key={n} value={n}>
                  {n}pt
                </option>
              ))}
            </select>
          </div>

          <button type="button" onClick={clear} className="stroke-slate-600 fill-transparent">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              viewBox="0 0 24 24"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="h-screen w-screen"
        onMouseDown={onPointerDown}
        onMouseUp={onPointerUp}
        onMouseMove={onPointerMove}
        onTouchStart={onPointerDown}
        onTouchEnd={onPointerUp}
        onTouchMove={onPointerMove}
      />
    </div>
  )
}
