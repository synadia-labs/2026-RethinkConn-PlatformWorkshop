import { useEffect, useRef } from 'react'
import type { NatsConnection } from '@nats-io/nats-core'
import { nuid } from '@nats-io/nats-core'
import { jetstream } from '@nats-io/jetstream'
import type { Message, ShapeMessage } from '#/lib/types'

const PREVIEW_W = 400
const PREVIEW_H = 280

export function WhiteboardPreview({ id, nc, jsPrefix, deliverPrefix }: { id: string; nc: NatsConnection; jsPrefix?: string; deliverPrefix?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = PREVIEW_W
    canvas.height = PREVIEW_H

    let cancelled = false

    function renderShape(c: CanvasRenderingContext2D, data: ShapeMessage, scaleX: number, scaleY: number) {
      const scale = Math.min(scaleX, scaleY)
      c.lineWidth = data.thickness * scale
      c.lineCap = 'round'
      c.lineJoin = 'round'
      c.strokeStyle = data.color

      const ox = data.origin.x * scaleX
      const oy = data.origin.y * scaleY
      const ex = data.endpoint.x * scaleX
      const ey = data.endpoint.y * scaleY

      switch (data.shape) {
        case 'line':
          c.beginPath()
          c.moveTo(ox, oy)
          c.lineTo(ex, ey)
          c.stroke()
          break
        case 'rect':
          c.strokeRect(ox, oy, ex - ox, ey - oy)
          break
        case 'ellipse': {
          const cx = (ox + ex) / 2
          const cy = (oy + ey) / 2
          const rx = Math.abs(ex - ox) / 2
          const ry = Math.abs(ey - oy) / 2
          c.beginPath()
          c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
          c.stroke()
          break
        }
      }
    }

    function renderMessage(data: Message) {
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
      } else if (data.type === 'shape') {
        const scaleX = PREVIEW_W / window.innerWidth
        const scaleY = PREVIEW_H / window.innerHeight
        renderShape(ctx!, data, scaleX, scaleY)
      } else {
        ctx!.clearRect(0, 0, PREVIEW_W, PREVIEW_H)
      }
    }

    async function replay() {
      const shared = !!jsPrefix
      const streamName = `whiteboard_${id}`

      if (shared) {
        const deliverSubject = `${deliverPrefix}.${nuid.next()}`
        const consumerName = nuid.next()
        const createSubject = `${jsPrefix}.API.CONSUMER.CREATE.${streamName}.${consumerName}`
        const config = {
          stream_name: streamName,
          config: {
            name: consumerName,
            deliver_subject: deliverSubject,
            deliver_policy: 'all',
            ack_policy: 'none',
            inactive_threshold: 10_000_000_000,
            num_replicas: 1,
            mem_storage: true,
          },
        }
        const resp = await nc.request(createSubject, JSON.stringify(config), { timeout: 10_000 })
        const ci = JSON.parse(new TextDecoder().decode(resp.data))
        if (ci.error) return

        const sub = nc.subscribe(deliverSubject)
        for await (const m of sub) {
          if (cancelled) break
          try {
            renderMessage(JSON.parse(new TextDecoder().decode(m.data)))
          } catch {
            // skip malformed
          }
        }
      } else {
        const js = jetstream(nc)
        let consumer
        try {
          consumer = await js.consumers.get(streamName, {
            inactive_threshold: 10_000,
          })
        } catch {
          return
        }

        const batch = await consumer.fetch({ max_messages: 4096, expires: 3000 })
        for await (const m of batch) {
          if (cancelled) break
          try {
            renderMessage(m.json<Message>())
          } catch {
            // skip malformed
          }
          m.ack()
        }
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
