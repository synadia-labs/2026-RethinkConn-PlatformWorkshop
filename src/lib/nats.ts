import type { JetStreamClient } from '@nats-io/jetstream'
import { jetstream, jetstreamManager } from '@nats-io/jetstream'
import type { NatsConnection } from '@nats-io/nats-core'
import { credsAuthenticator, headers, wsconnect } from '@nats-io/nats-core'

const NGS_WS_URL = 'wss://connect.ngs.synadia-test.com'

export interface NatsContext {
  nc: NatsConnection
  js: JetStreamClient
}

export async function connectNats(): Promise<NatsContext> {
  const creds = localStorage.getItem('sygma_creds')
  if (!creds) {
    throw new Error('Not signed in')
  }
  const nc = await wsconnect({
    servers: NGS_WS_URL,
    authenticator: credsAuthenticator(new TextEncoder().encode(creds)),
    ignoreClusterUpdates: true,
  })
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
