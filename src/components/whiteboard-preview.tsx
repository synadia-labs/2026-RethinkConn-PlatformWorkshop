import { useEffect, useRef } from 'react'
import type { NatsConnection } from '@nats-io/nats-core'
import { nanos } from '@nats-io/nats-core'
import { jetstream } from '@nats-io/jetstream'

interface Point {
  x: number
  y: number
}

interface DrawMessage {
  type: 'draw'
  from: Point
  to: Point
  thickness: number
  color: string
}

interface ClearMessage {
  type: 'clear'
}

type Message = DrawMessage | ClearMessage

const PREVIEW_W = 400
const PREVIEW_H = 280

export function WhiteboardPreview({ id, nc }: { id: string; nc: NatsConnection }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = PREVIEW_W
    canvas.height = PREVIEW_H

    let cancelled = false

    async function replay() {
      const js = jetstream(nc)
      const streamName = `whiteboard_${id}`

      let consumer
      try {
        consumer = await js.consumers.get(streamName, {
          inactive_threshold: nanos(10 * 1000),
        })
      } catch {
        return
      }

      const batch = await consumer.fetch({ max_messages: 4096, expires: 3000 })
      for await (const m of batch) {
        if (cancelled) break
        try {
          const data = m.json<Message>()
          if (data.type === 'draw') {
            const scaleX = PREVIEW_W / window.innerWidth
            const scaleY = PREVIEW_H / window.innerHeight
            ctx!.beginPath()
            ctx!.lineWidth = data.thickness * Math.min(scaleX, scaleY)
            ctx!.lineCap = 'round'
            ctx!.lineJoin = 'round'
            ctx!.strokeStyle = data.color
            ctx!.moveTo(data.from.x * scaleX, data.from.y * scaleY)
            ctx!.lineTo(data.to.x * scaleX, data.to.y * scaleY)
            ctx!.stroke()
          } else {
            ctx!.clearRect(0, 0, PREVIEW_W, PREVIEW_H)
          }
        } catch {
          // skip malformed
        }
        m.ack()
      }
    }

    replay().catch(console.error)

    return () => {
      cancelled = true
    }
  }, [id, nc])

  return (
    <canvas
      ref={canvasRef}
      width={PREVIEW_W}
      height={PREVIEW_H}
      className="h-full w-full"
    />
  )
}
