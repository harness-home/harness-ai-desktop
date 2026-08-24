import type { HostedEvent } from '@harness-ai/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAttachmentSync, type AttachmentSyncDeps } from './attachment-sync'

vi.mock('../log', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {} },
}))

const SERVER = 'https://server.test'
const ID_A = `sha256:${'a'.repeat(64)}`
const ID_B = `sha256:${'b'.repeat(64)}`

function imageEvent(seq: number, attachmentId: string, bytes = 1024): HostedEvent {
  return {
    seq,
    time: seq,
    type: 'user/message',
    data: {
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        {
          type: 'image',
          attachment: { attachmentId, mediaType: 'image/png', bytes, width: 10, height: 10 },
        },
      ],
    },
  }
}

interface Harness {
  deps: AttachmentSyncDeps
  fetchMock: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
  posts: () => { sessionId: string; body: { attachment: { attachmentId: string }; data: string } }[]
}

function harness(options: { manifest?: string[]; uploadStatus?: number; manifestStatus?: number } = {}): Harness {
  const posted: { sessionId: string; body: { attachment: { attachmentId: string }; data: string } }[] = []
  const fetchMock = vi.fn((url: string, init?: { method?: string; body?: string }) => {
    const sessionId = /\/sessions\/([^/]+)\/attachments/.exec(url)?.[1] ?? ''
    if ((init?.method ?? 'GET') === 'GET') {
      const status = options.manifestStatus ?? 200
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve({ attachmentIds: options.manifest ?? [] }),
      })
    }
    const status = options.uploadStatus ?? 200
    if (status >= 200 && status < 300) {
      posted.push({ sessionId, body: JSON.parse(init?.body ?? '{}') as never })
    }
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve({ attachmentId: ID_A, deduped: false }),
    })
  })
  vi.stubGlobal('fetch', fetchMock)

  const rpc = vi.fn((_method: string, payload: unknown) => {
    const { attachmentId } = payload as { attachmentId: string }
    return Promise.resolve({
      attachment: { attachmentId, mediaType: 'image/png', bytes: 1024, width: 10, height: 10 },
      data: 'QUJD',
    })
  })

  return {
    deps: {
      serverUrl: SERVER,
      authHeaders: () => ({ Authorization: 'Bearer t' }),
      localRpc: rpc as unknown as AttachmentSyncDeps['localRpc'],
    },
    fetchMock,
    rpc,
    posts: () => posted,
  }
}

beforeEach(() => {
  vi.useRealTimers()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createAttachmentSync', () => {
  it('queues references found in synced events', () => {
    const h = harness()
    const sync = createAttachmentSync(h.deps)
    sync.note('s1', [imageEvent(1, ID_A), imageEvent(2, ID_B)])
    expect(sync.pending()).toBe(2)
  })

  it('queues one id once even across several events', () => {
    const h = harness()
    const sync = createAttachmentSync(h.deps)
    sync.note('s1', [imageEvent(1, ID_A), imageEvent(2, ID_A)])
    expect(sync.pending()).toBe(1)
  })

  it('uploads pending bytes fetched from the local runtime', async () => {
    const h = harness()
    const sync = createAttachmentSync(h.deps)
    sync.note('s1', [imageEvent(1, ID_A)])
    await sync.pump()
    expect(h.rpc).toHaveBeenCalledWith('session.attachment', { sessionId: 's1', attachmentId: ID_A })
    expect(h.posts()).toHaveLength(1)
    expect(h.posts()[0]?.body.data).toBe('QUJD')
    expect(sync.pending()).toBe(0)
  })

  it('skips ids the server manifest already lists', async () => {
    const h = harness({ manifest: [ID_A] })
    const sync = createAttachmentSync(h.deps)
    sync.note('s1', [imageEvent(1, ID_A), imageEvent(2, ID_B)])
    await sync.pump()
    expect(h.posts().map((p) => p.body.attachment.attachmentId)).toEqual([ID_B])
  })

  it('does not re-queue an id it already uploaded', async () => {
    const h = harness()
    const sync = createAttachmentSync(h.deps)
    sync.note('s1', [imageEvent(1, ID_A)])
    await sync.pump()
    sync.note('s1', [imageEvent(5, ID_A)])
    expect(sync.pending()).toBe(0)
  })

  it('drops a reference whose declared size exceeds the ceiling', () => {
    const h = harness()
    const sync = createAttachmentSync(h.deps)
    sync.note('s1', [imageEvent(1, ID_A, 64 * 1024 * 1024)])
    expect(sync.pending()).toBe(0)
  })

  it('stops asking when the server has attachments disabled', async () => {
    const h = harness({ manifestStatus: 404 })
    const sync = createAttachmentSync(h.deps)
    sync.note('s1', [imageEvent(1, ID_A)])
    await sync.pump()
    expect(h.posts()).toHaveLength(0)
    // Suspended: later events must not re-open the channel.
    sync.note('s1', [imageEvent(2, ID_B)])
    expect(sync.pending()).toBe(0)
  })

  it('gives up on one blob the server rejects, without stalling the rest', async () => {
    const h = harness({ uploadStatus: 400 })
    const sync = createAttachmentSync(h.deps)
    sync.note('s1', [imageEvent(1, ID_A), imageEvent(2, ID_B)])
    await sync.pump()
    expect(sync.pending()).toBe(0)
    expect(h.posts()).toHaveLength(0)
  })

  it('keeps a blob queued when the server fails transiently', async () => {
    const h = harness({ uploadStatus: 503 })
    const sync = createAttachmentSync(h.deps)
    sync.note('s1', [imageEvent(1, ID_A)])
    await sync.pump()
    expect(sync.pending()).toBe(1)
  })

  it('uploads nothing while signed out', async () => {
    const h = harness()
    const sync = createAttachmentSync({ ...h.deps, authHeaders: () => undefined })
    sync.note('s1', [imageEvent(1, ID_A)])
    await sync.pump()
    expect(h.fetchMock).not.toHaveBeenCalled()
    expect(sync.pending()).toBe(1)
  })

  it('stops accepting work after stop()', () => {
    const h = harness()
    const sync = createAttachmentSync(h.deps)
    sync.stop()
    sync.note('s1', [imageEvent(1, ID_A)])
    expect(sync.pending()).toBe(0)
  })
})
