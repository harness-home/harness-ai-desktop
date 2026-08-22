// Hosting bridge (features H2 + W1): mirrors local session events to
// harness-ai-server and keeps the outbound device link open for remote
// approvals and prompts. Sources everything from the local loopback /api
// (mux WebSocket + RPC), so no dsh internals are touched; the harness itself
// never leaves loopback (workspace red line #4).
//
// Sensitive-data rules (ledger #26) are applied client-side before upload:
// credential-shaped strings are masked, sessions whose cwd hits the denylist
// are never synced, and attachment/spill bytes never ride this channel (the
// event log only carries references).
import { homedir } from 'node:os'
import WebSocket from 'ws'
import type {
  HostedEvent,
  HostedSessionHead,
  HostingSyncResponse,
  HostingWatermarksResponse,
  LinkDownFrame,
  LinkUpFrame,
} from '@harness-ai/contracts'
import { linkDownFrameSchema } from '@harness-ai/contracts'
import type { DesktopAccountService } from '../account/service'
import { log } from '../log'
import { maskSecrets } from '../mask-secrets'

const RETRY_MS = 5_000
const BATCH_MAX = 200

/** Default cwd denylist (path segments, case-insensitive): never synced. */
const DENYLIST_SEGMENTS = ['.ssh', '.aws', '.gnupg', '.dsh', '.config/gh']

interface SessionListItem {
  sessionId: string
  updatedAt: number
  running: boolean
  cwd?: string
  title?: string
}

export interface HostingBridgeOptions {
  /** Local dsh origin, e.g. http://127.0.0.1:43110 */
  localBaseUrl: string
  account: DesktopAccountService
  harnessFormatVersion: string
  /** Drop assistant/chunk events and mark the stream lossy. */
  dropChunks?: boolean
}

/** True when a cwd falls under the never-sync denylist (ledger #26 rule 2). */
export function cwdDenied(cwd: string, extra: readonly string[] = []): boolean {
  const normalized = cwd.replaceAll('\\', '/').toLowerCase() + '/'
  const home = homedir().replaceAll('\\', '/').toLowerCase()
  for (const segment of [...DENYLIST_SEGMENTS, ...extra]) {
    const needle = segment.replaceAll('\\', '/').toLowerCase()
    if (normalized.includes(`/${needle}/`) || normalized === `${home}/${needle}/`) return true
  }
  return false
}

/** Mask credential-shaped strings inside one event (ledger #26 rule 1). */
export function filterEvent(event: HostedEvent): HostedEvent {
  if (event.data === undefined) return event
  try {
    return { ...event, data: JSON.parse(maskSecrets(JSON.stringify(event.data))) as unknown }
  } catch {
    // A payload that cannot round-trip is dropped rather than sent raw.
    return { ...event, data: { omitted: 'unserializable' } }
  }
}

export function startHostingBridge(options: HostingBridgeOptions): { stop: () => void } {
  const serverUrl = options.account.serverUrl
  let stopped = false
  let mux: WebSocket | undefined
  let link: WebSocket | undefined
  /** Pending upload queue per session; watermark = highest seq the server holds. */
  const queues = new Map<string, HostedEvent[]>()
  const watermarks = new Map<string, number>()
  const denied = new Set<string>()
  const heads = new Map<string, SessionListItem>()
  /** approvalId → local mux rpcId (needed to answer /api/respond). */
  const approvalRpcIds = new Map<string, string>()
  let flushing = false
  let extraDenylist: string[] = []
  if (process.env.HARNESS_SYNC_DENYLIST !== undefined) {
    extraDenylist = process.env.HARNESS_SYNC_DENYLIST.split(',').map((s) => s.trim()).filter(Boolean)
  }

  const authHeaders = (): Record<string, string> | undefined => {
    const auth = options.account.auth()
    if (auth === undefined) return undefined
    return {
      Authorization: `Bearer ${auth.token}`,
      Origin: serverUrl,
      'Content-Type': 'application/json',
      ...(auth.deviceId === undefined ? {} : { 'x-harness-device-id': auth.deviceId }),
    }
  }

  const localRpc = async (method: string, payload: unknown): Promise<unknown> => {
    const res = await fetch(`${options.localBaseUrl}/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', method, rpcId: `hosting-${Date.now()}`, payload }),
    })
    const json = (await res.json()) as { result?: { ok?: boolean; value?: unknown; error?: unknown } }
    if (json.result?.ok !== true) throw new Error(`local ${method} failed: ${JSON.stringify(json.result?.error).slice(0, 200)}`)
    return json.result.value
  }

  const refreshHeads = async (): Promise<void> => {
    const value = (await localRpc('session.list', {})) as { items?: SessionListItem[] }
    for (const item of value.items ?? []) heads.set(item.sessionId, item)
  }

  const headFor = (sessionId: string): HostedSessionHead | undefined => {
    const item = heads.get(sessionId)
    if (item === undefined) return undefined
    return {
      sessionId,
      harnessType: 'dsh',
      harnessFormatVersion: options.harnessFormatVersion,
      cwd: item.cwd ?? '',
      title: item.title ?? null,
      running: item.running,
      updatedAt: new Date(item.updatedAt).toISOString(),
    }
  }

  const enqueue = (sessionId: string, events: HostedEvent[]): void => {
    if (denied.has(sessionId)) return
    const queue = queues.get(sessionId) ?? []
    for (const event of events) {
      if (options.dropChunks === true && event.type === 'assistant/chunk') continue
      queue.push(filterEvent(event))
    }
    queues.set(sessionId, queue)
    void flush()
  }

  const flush = async (): Promise<void> => {
    if (flushing || stopped) return
    flushing = true
    try {
      const headers = authHeaders()
      if (headers === undefined) return
      for (const [sessionId, queue] of queues) {
        if (queue.length === 0) continue
        if (!heads.has(sessionId)) await refreshHeads().catch(() => {})
        const head = headFor(sessionId)
        if (head === undefined) continue
        if (head.cwd !== '' && cwdDenied(head.cwd, extraDenylist)) {
          denied.add(sessionId)
          queues.delete(sessionId)
          log.info(`hosting: session ${sessionId} matches the sync denylist; not synced`)
          continue
        }
        const watermark = watermarks.get(sessionId) ?? -1
        const batch = queue.filter((event) => event.seq > watermark).slice(0, BATCH_MAX)
        if (batch.length === 0) {
          queues.set(sessionId, [])
          continue
        }
        const res = await fetch(`${serverUrl}/api/hosting/sessions/${sessionId}/sync`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            head,
            events: batch,
            ...(options.dropChunks === true ? { lossy: true } : {}),
          }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) throw new Error(`sync returned ${String(res.status)}`)
        const value = (await res.json()) as HostingSyncResponse
        watermarks.set(sessionId, value.lastSeq)
        queues.set(sessionId, queue.filter((event) => event.seq > value.lastSeq))
      }
    } catch (error) {
      log.warn(`hosting: sync deferred: ${error instanceof Error ? error.message : String(error)}`)
      setTimeout(() => void flush(), RETRY_MS)
    } finally {
      flushing = false
    }
  }

  /** Backfill one session's server gap from local history (pages backwards). */
  const backfill = async (sessionId: string, since: number): Promise<void> => {
    const collected: HostedEvent[] = []
    let beforeSeq: number | undefined
    for (let page = 0; page < 50; page += 1) {
      const value = (await localRpc('session.history', {
        sessionId,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      })) as { events?: { event: HostedEvent }[]; hasMore?: boolean }
      const events = (value.events ?? []).map((wrapper) => wrapper.event)
      if (events.length === 0) break
      collected.unshift(...events)
      const minSeq = Math.min(...events.map((event) => event.seq))
      if (value.hasMore !== true || minSeq <= since + 1) break
      beforeSeq = minSeq
    }
    const fresh = collected.filter((event) => event.seq > since)
    if (fresh.length > 0) enqueue(sessionId, fresh)
  }

  const reconcile = async (): Promise<void> => {
    const headers = authHeaders()
    if (headers === undefined) return
    await refreshHeads()
    const res = await fetch(`${serverUrl}/api/hosting/watermarks`, {
      headers, signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return
    const value = (await res.json()) as HostingWatermarksResponse
    for (const [sessionId, seq] of Object.entries(value.watermarks)) watermarks.set(sessionId, seq)
    // Catch up every locally known session the server is behind on.
    for (const sessionId of heads.keys()) {
      const since = watermarks.get(sessionId) ?? -1
      await backfill(sessionId, since).catch((error: unknown) => {
        log.warn(`hosting: backfill ${sessionId} failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }

  // --- Local mux consumer ---------------------------------------------------

  const connectMux = (): void => {
    if (stopped) return
    mux = new WebSocket(`${options.localBaseUrl.replace('http', 'ws')}/api/events.mux`)
    mux.on('message', (raw) => {
      let frame: { rpcId?: string; payload?: Record<string, unknown> }
      try { frame = JSON.parse(String(raw)) as typeof frame } catch { return }
      const payload = frame.payload ?? (frame as Record<string, unknown>)
      const type = payload.type
      if (type === 'session/event') {
        const sessionId = payload.sessionId as string
        enqueue(sessionId, [payload.event as HostedEvent])
      } else if (type === 'session/subscribed') {
        void refreshHeads().catch(() => {})
      } else if (type === 'approval/requested') {
        const approvalId = payload.approvalId as string
        if (frame.rpcId !== undefined) approvalRpcIds.set(approvalId, frame.rpcId)
        sendLink({
          type: 'approval-pending',
          approvalId,
          sessionId: payload.sessionId as string,
          toolName: (payload.toolName as string | undefined) ?? 'tool',
          reason: (payload.reason as string | undefined) ?? null,
        })
      } else if (type === 'approval/resolved') {
        const approvalId = payload.approvalId as string
        approvalRpcIds.delete(approvalId)
        sendLink({
          type: 'approval-resolved',
          approvalId,
          sessionId: payload.sessionId as string,
          outcome: String(payload.outcome),
        })
      }
    })
    mux.on('close', () => {
      if (!stopped) setTimeout(connectMux, RETRY_MS)
    })
    mux.on('error', () => { mux?.close() })
  }

  // --- Device link (outbound) ----------------------------------------------

  const sendLink = (frame: LinkUpFrame): void => {
    if (link?.readyState === WebSocket.OPEN) link.send(JSON.stringify(frame))
  }

  const handleCommand = async (frame: LinkDownFrame): Promise<void> => {
    if (frame.type === 'approve') {
      const rpcId = approvalRpcIds.get(frame.approvalId)
      if (rpcId === undefined) throw new Error('approval no longer pending')
      const res = await fetch(`${options.localBaseUrl}/api/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'client-response',
          rpcId,
          result: {
            ok: true,
            value: { sessionId: frame.sessionId, approvalId: frame.approvalId, outcome: frame.outcome },
          },
        }),
      })
      const receipt = (await res.json()) as { accepted?: boolean }
      if (receipt.accepted !== true) throw new Error('local respond not accepted')
    } else {
      await localRpc('session.prompt', {
        sessionId: frame.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: frame.text }],
      })
    }
  }

  const connectLink = (): void => {
    if (stopped) return
    const auth = options.account.auth()
    if (auth?.deviceId === undefined) {
      setTimeout(connectLink, RETRY_MS)
      return
    }
    link = new WebSocket(`${serverUrl.replace('http', 'ws')}/api/link`, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'x-harness-device-id': auth.deviceId,
      },
    })
    link.on('open', () => {
      log.info('hosting: device link connected')
      void reconcile().catch(() => {})
    })
    link.on('message', (raw) => {
      let parsedFrame: unknown
      try { parsedFrame = JSON.parse(String(raw)) } catch { return }
      const parsed = linkDownFrameSchema.safeParse(parsedFrame)
      if (!parsed.success) return
      const frame = parsed.data
      void handleCommand(frame)
        .then(() => sendLink({ type: 'command-result', commandId: frame.commandId, ok: true }))
        .catch((error: unknown) => sendLink({
          type: 'command-result',
          commandId: frame.commandId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }))
    })
    link.on('close', () => {
      if (!stopped) setTimeout(connectLink, RETRY_MS)
    })
    link.on('error', () => { link?.close() })
  }

  connectMux()
  connectLink()

  return {
    stop: () => {
      stopped = true
      mux?.close()
      link?.close()
    },
  }
}
