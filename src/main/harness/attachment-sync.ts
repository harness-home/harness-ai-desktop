import {
  HOSTED_ATTACHMENT_MAX_BYTES,
  attachmentManifestResponseSchema,
  collectEventAttachments,
  hostedAttachmentSchema,
  sessionAttachmentsPath,
  type HostedAttachment,
  type HostedEvent,
} from '@harness-ai/contracts'
import { log } from '../log'

// Attachment upload half of the hosting bridge (P3.5).
//
// The event log only ever carries a content-addressed reference; the bytes
// travel here, on their own channel, after the referencing events are already
// stored. Decoupling them is what keeps a 4 MiB screenshot from delaying the
// transcript — and what makes a failed upload cost one missing image instead of
// a stalled session.
//
// The digest doing double duty as the id is why this stays simple: uploads are
// idempotent, the server can verify what it was handed, and "already have it"
// is a set membership test rather than a protocol.

/** Attachment ids that will never succeed; retrying them only wastes calls. */
type Outcome = 'uploaded' | 'permanent-failure'

export interface AttachmentSyncDeps {
  serverUrl: string
  /** Bearer/device headers, or undefined while signed out. */
  authHeaders: () => Record<string, string> | undefined
  /** Loopback RPC into the local runtime. */
  localRpc: (method: string, payload: unknown) => Promise<unknown>
}

export interface AttachmentSync {
  /** Record every attachment referenced by events that reached the server. */
  note: (sessionId: string, events: readonly HostedEvent[]) => void
  /** Upload what is pending. Safe to call concurrently; runs one pass at a time. */
  pump: () => Promise<void>
  stop: () => void
  /** Pending id count, for logging and tests. */
  pending: () => number
}

interface LocalAttachmentReply {
  attachment?: unknown
  data?: unknown
}

export function createAttachmentSync(deps: AttachmentSyncDeps): AttachmentSync {
  /** sessionId → attachment ids seen in synced events and not yet stored. */
  const pending = new Map<string, Map<string, HostedAttachment>>()
  /** sessionId → ids known to be on the server (from its manifest or our uploads). */
  const stored = new Map<string, Set<string>>()
  /** Sessions whose manifest has been read this run. */
  const manifestRead = new Set<string>()
  let running = false
  let stopped = false
  /** Set when the server refuses all attachments (disabled, or quota full). */
  let suspended = false

  /**
   * Give up on the whole channel. The queue is dropped rather than held: the
   * server has said it will not take these bytes, so keeping them only grows
   * memory for the life of the process.
   */
  const suspend = (reason: string): void => {
    suspended = true
    pending.clear()
    log.info(`hosting: ${reason}; syncing references only`)
  }

  const storedFor = (sessionId: string): Set<string> => {
    const set = stored.get(sessionId) ?? new Set<string>()
    stored.set(sessionId, set)
    return set
  }

  const note = (sessionId: string, events: readonly HostedEvent[]): void => {
    if (stopped || suspended) return
    for (const event of events) {
      for (const attachment of collectEventAttachments(event)) {
        if (storedFor(sessionId).has(attachment.attachmentId)) continue
        // The runtime caps stored images well below this; anything above it is
        // malformed metadata, and uploading it would only earn a 413.
        if (attachment.bytes > HOSTED_ATTACHMENT_MAX_BYTES) {
          log.warn(`hosting: attachment ${attachment.attachmentId} exceeds the size ceiling; not synced`)
          storedFor(sessionId).add(attachment.attachmentId)
          continue
        }
        const queue = pending.get(sessionId) ?? new Map<string, HostedAttachment>()
        queue.set(attachment.attachmentId, attachment)
        pending.set(sessionId, queue)
      }
    }
  }

  /** Read which ids the server already holds, so a resync uploads nothing twice. */
  const readManifest = async (sessionId: string, headers: Record<string, string>): Promise<void> => {
    if (manifestRead.has(sessionId)) return
    const res = await fetch(`${deps.serverUrl}${sessionAttachmentsPath(sessionId)}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 404) {
      // The server does not store attachments at all; stop asking.
      suspend('server has attachments disabled')
      return
    }
    if (!res.ok) throw new Error(`attachment manifest returned ${String(res.status)}`)
    const parsed = attachmentManifestResponseSchema.safeParse(await res.json())
    if (!parsed.success) throw new Error('attachment manifest did not match the contract')
    const known = storedFor(sessionId)
    for (const id of parsed.data.attachmentIds) known.add(id)
    manifestRead.add(sessionId)
  }

  const uploadOne = async (
    sessionId: string,
    attachment: HostedAttachment,
    headers: Record<string, string>,
  ): Promise<Outcome> => {
    // The runtime only hands over an attachment through a session whose log
    // references it — the same rule the server enforces on read.
    const reply = (await deps.localRpc('session.attachment', {
      sessionId,
      attachmentId: attachment.attachmentId,
    })) as LocalAttachmentReply
    if (typeof reply.data !== 'string' || reply.data === '') {
      log.warn(`hosting: local runtime returned no bytes for ${attachment.attachmentId}`)
      return 'permanent-failure'
    }
    // Prefer the runtime's own metadata over what the event carried: the event
    // has been through secret masking, the RPC reply has not.
    const authoritative = hostedAttachmentSchema.safeParse(reply.attachment)
    const meta = authoritative.success ? authoritative.data : attachment

    const res = await fetch(`${deps.serverUrl}${sessionAttachmentsPath(sessionId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ attachment: meta, data: reply.data }),
      signal: AbortSignal.timeout(60_000),
    })
    if (res.ok) return 'uploaded'
    if (res.status === 404 || res.status === 507) {
      suspend(`server refused attachments (${String(res.status)})`)
      return 'permanent-failure'
    }
    // 400/403/413 describe this blob, not the channel: never retried.
    if (res.status >= 400 && res.status < 500) {
      log.warn(`hosting: attachment ${attachment.attachmentId} rejected (${String(res.status)}); skipped`)
      return 'permanent-failure'
    }
    throw new Error(`attachment upload returned ${String(res.status)}`)
  }

  const pump = async (): Promise<void> => {
    if (running || stopped || suspended) return
    const headers = deps.authHeaders()
    if (headers === undefined) return
    running = true
    try {
      for (const [sessionId, queue] of pending) {
        if (stopped || suspended) break
        try {
          await readManifest(sessionId, headers)
        } catch (error) {
          log.warn(`hosting: attachment manifest deferred for ${sessionId}: ${message(error)}`)
          continue
        }
        if (suspended) break
        const known = storedFor(sessionId)
        for (const [attachmentId, attachment] of [...queue]) {
          if (stopped || suspended) break
          if (known.has(attachmentId)) {
            queue.delete(attachmentId)
            continue
          }
          try {
            const outcome = await uploadOne(sessionId, attachment, headers)
            queue.delete(attachmentId)
            // A permanent failure is remembered too: re-queuing it on the next
            // batch would retry it forever.
            known.add(attachmentId)
            if (outcome === 'uploaded') log.info(`hosting: attachment ${attachmentId} synced`)
          } catch (error) {
            // Transient: leave it queued for the next pass.
            log.warn(`hosting: attachment upload deferred: ${message(error)}`)
            break
          }
        }
        if (queue.size === 0) pending.delete(sessionId)
      }
    } finally {
      running = false
    }
  }

  return {
    note,
    pump,
    stop: () => {
      stopped = true
    },
    pending: () => [...pending.values()].reduce((total, queue) => total + queue.size, 0),
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
