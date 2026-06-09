import type { JetStreamClient } from '@nats-io/jetstream'
import { jetstream, jetstreamManager } from '@nats-io/jetstream'
import type { NatsConnection } from '@nats-io/nats-core'
import {
  credsAuthenticator,
  headers,
  nuid,
  wsconnect,
} from '@nats-io/nats-core'

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
    debug: true,
  })
  const js = jetstream(nc)
  return { nc, js }
}

export interface WhiteboardInfo {
  id: string
  name: string
  lastModified?: string
  shared?: boolean
  jsPrefix?: string
  deliverPrefix?: string
}

const STREAM_PREFIX = 'whiteboard_'
const STREAM_MAX_BYTES = 10 * 1024 * 1024 // 10 MiB per whiteboard

export async function createWhiteboard(
  nc: NatsConnection,
  name: string,
): Promise<WhiteboardInfo> {
  const id = nuid.next()
  const streamName = STREAM_PREFIX + id
  const jsm = await jetstreamManager(nc)
  await jsm.streams.add({
    name: streamName,
    subjects: [`whiteboard.${id}.>`],
    description: name,
    allow_rollup_hdrs: true,
    max_bytes: STREAM_MAX_BYTES,
  })
  return { id, name }
}

export async function listWhiteboards(
  nc: NatsConnection,
): Promise<WhiteboardInfo[]> {
  const jsm = await jetstreamManager(nc)
  const boards: WhiteboardInfo[] = []
  for await (const info of jsm.streams.list()) {
    if (!info.config.name.startsWith(STREAM_PREFIX)) continue
    const id = info.config.name.slice(STREAM_PREFIX.length)
    const lastMsg = info.state.last_ts
    boards.push({
      id,
      name: info.config.description || id,
      lastModified: lastMsg,
    })
  }
  return boards
}

export async function listSharedWhiteboards(
  nc: NatsConnection,
): Promise<WhiteboardInfo[]> {
  const accountId = localStorage.getItem('sygma_account_id')
  if (!accountId) return []
  const payload = JSON.stringify({ account_id: accountId })
  const resp = await nc.request('sygma.whiteboard.list-shared', payload, {
    timeout: 10_000,
  })
  const data = JSON.parse(new TextDecoder().decode(resp.data)) as {
    boards?: Array<{
      stream_name: string
      board_name: string
      js_prefix: string
      deliver_prefix: string
    }>
    error?: string
  }
  if (data.error || !data.boards) return []
  return data.boards.map((b) => {
    const id = b.stream_name.slice(STREAM_PREFIX.length)
    return {
      id,
      name: b.board_name || id,
      shared: true,
      jsPrefix: b.js_prefix,
      deliverPrefix: b.deliver_prefix,
    }
  })
}

export async function renameWhiteboard(
  nc: NatsConnection,
  id: string,
  name: string,
): Promise<void> {
  const streamName = STREAM_PREFIX + id
  const jsm = await jetstreamManager(nc)
  const info = await jsm.streams.info(streamName)
  await jsm.streams.update(streamName, { ...info.config, description: name })
}

export async function deleteWhiteboard(
  nc: NatsConnection,
  id: string,
): Promise<void> {
  const jsm = await jetstreamManager(nc)
  await jsm.streams.delete(STREAM_PREFIX + id)
}

export async function unshareWhiteboard(
  nc: NatsConnection,
  id: string,
): Promise<void> {
  const accountId = localStorage.getItem('sygma_account_id')
  if (!accountId) throw new Error('Not signed in')
  const payload = JSON.stringify({ account_id: accountId, board_id: id })
  const resp = await nc.request('sygma.whiteboard.unshare', payload, { timeout: 10_000 })
  const data = JSON.parse(new TextDecoder().decode(resp.data)) as { ok?: boolean; error?: string }
  if (data.error) throw new Error(data.error)
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
      max_bytes: STREAM_MAX_BYTES,
    })
  }
}

export function rollupHeaders() {
  const h = headers()
  h.set('Nats-Rollup', 'sub')
  return h
}
