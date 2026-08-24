import { foldSessionEvents, type HostedEvent } from '@harness-ai/contracts'
import { describe, expect, it } from 'vitest'

// Folds a real hosted session straight out of a running server, and fetches
// the image it references.
//
// Everything the unit tests construct by hand is genuine here: the events came
// from a live runtime turn, went through the uploader's secret masking, and
// were stored and served back. That last part is the one worth a live run —
// the masking pass rewrites the whole payload, and a mangled attachment id
// still typechecks, still syncs, and only fails when someone tries to look at
// the picture.
//
// Skipped unless HARNESS_E2E_SESSION names a session with an image in it.

const BASE = process.env.HARNESS_SERVER_BASE ?? 'http://localhost:8720'
const SESSION = process.env.HARNESS_E2E_SESSION
const EMAIL = process.env.HARNESS_E2E_EMAIL ?? ''
const PASSWORD = process.env.HARNESS_E2E_PASSWORD ?? ''

/** PNG signature, so "we got bytes back" is not mistaken for "we got an image". */
const PNG_MAGIC = '89504e470d0a1a0a'

describe.skipIf(SESSION === undefined)('folding a real hosted session', () => {
  it('carries a tool-returned image through to a fetchable blob', async () => {
    const headers = { 'Content-Type': 'application/json', Origin: BASE }
    const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
    const token = signIn.headers.get('set-auth-token')
    expect(token).toBeTruthy()
    const auth = { ...headers, Authorization: `Bearer ${String(token)}` }

    const res = await fetch(`${BASE}/api/hosting/sessions/${String(SESSION)}/events?since=-1`, { headers: auth })
    const body = (await res.json()) as { events: HostedEvent[] }
    expect(body.events.length).toBeGreaterThan(0)

    const messages = foldSessionEvents(body.events, { streamingTail: true })
    const carrying = messages.filter((message) => (message.attachments ?? []).length > 0)
    expect(carrying.length).toBeGreaterThan(0)

    const attachment = carrying[0]?.attachments?.[0]
    // Intact after masking, or the blob is unreachable by the id in the log.
    expect(attachment?.attachmentId).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(attachment?.mediaType).toMatch(/^image\//)
    expect(attachment?.bytes).toBeGreaterThan(0)

    const blob = await fetch(
      `${BASE}/api/hosting/sessions/${String(SESSION)}/attachments/`
      + encodeURIComponent(String(attachment?.attachmentId)),
      { headers: auth },
    )
    expect(blob.status).toBe(200)
    const payload = (await blob.json()) as { data: string; attachment: { bytes: number } }
    const bytes = Buffer.from(payload.data, 'base64')
    expect(bytes.subarray(0, 8).toString('hex')).toBe(PNG_MAGIC)
    expect(bytes.byteLength).toBe(attachment?.bytes)
  }, 60_000)
})
