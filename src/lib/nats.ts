import { wsconnect, headers } from '@nats-io/nats-core'
import type { NatsConnection } from '@nats-io/nats-core'
import { jetstream, jetstreamManager } from '@nats-io/jetstream'
import type { JetStreamClient } from '@nats-io/jetstream'

const NATS_WS_URL = 'ws://localhost:9222'

export interface NatsContext {
  nc: NatsConnection
  js: JetStreamClient
}

export async function connectNats(): Promise<NatsContext> {
  const nc = await wsconnect({ servers: NATS_WS_URL })
  const js = jetstream(nc)
  return { nc, js }
}

export async function ensureStream(
  nc: NatsConnection,
  name: string,
  subjects: string[],
): Promise<void> {
  const jsm = await jetstreamManager(nc)
  try {
    await jsm.streams.info(name)
  } catch {
    await jsm.streams.add({
      name,
      subjects,
      allow_rollup_hdrs: true,
    })
  }
}

export function rollupHeaders() {
  const h = headers()
  h.set('Nats-Rollup', 'sub')
  return h
}
