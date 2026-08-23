// Deep links: the public website hands a catalog listing to this client over a
// custom URL scheme instead of installing anything itself.
//
// Security posture — a deep link is untrusted input from a browser, so it may
// only ever carry a catalog *id*. The id is validated against the shared
// contract, the client re-resolves it against the market server, and the user
// still confirms the install in the market panel. A link can therefore never
// name an arbitrary package, and never installs anything on its own.
import { resolve } from 'node:path'
import { marketListingSchema } from '@harness-ai/contracts'
import { app } from 'electron'

/** URL scheme registered with the operating system. */
export const DEEP_LINK_SCHEME = 'harness-ai'

const SCHEME_PREFIX = `${DEEP_LINK_SCHEME}://`

export type DeepLinkRequest =
  /** Just bring the client to the front. */
  | { kind: 'open' }
  /** Offer to install one catalog listing. */
  | { kind: 'install'; listingId: string }

/**
 * Parse one deep link. Returns null for anything unrecognized — an unknown
 * action, a missing id, or an id the catalog contract would reject.
 */
export function parseDeepLink(raw: string): DeepLinkRequest | null {
  if (!raw.toLowerCase().startsWith(SCHEME_PREFIX)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  // `harness-ai://install?...` puts the action in the host; a link written as
  // `harness-ai:///install` puts it in the path. Accept both.
  const action = (url.hostname === '' ? url.pathname.replace(/^\/+/, '') : url.hostname)
    .replace(/\/+$/, '')
    .toLowerCase()

  if (action === 'open') return { kind: 'open' }
  if (action !== 'install') return null

  const listingId = url.searchParams.get('listing')
  if (listingId === null) return null
  const parsed = marketListingSchema.shape.id.safeParse(listingId)
  if (!parsed.success) return null
  return { kind: 'install', listingId: parsed.data }
}

/** The first deep link in a process argument list, if there is one. */
export function deepLinkFromArgv(argv: readonly string[]): string | undefined {
  return argv.find((arg) => arg.toLowerCase().startsWith(SCHEME_PREFIX))
}

/**
 * Claim the scheme with the operating system. In a packaged app this is one
 * call; running from source, Windows needs the interpreter and the entry
 * script spelled out or it would launch Electron with no application.
 */
export function registerProtocolClient(): boolean {
  if (!app.isPackaged && process.argv.length >= 2) {
    const entry = process.argv[1]
    if (entry === undefined) return false
    return app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [resolve(entry)])
  }
  return app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
}
