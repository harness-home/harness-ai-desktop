// Application updates.
//
// electron-updater against a generic feed: the packaged build carries the feed
// written by electron-builder (`app-update.yml`), and `HARNESS_UPDATE_FEED_URL`
// overrides it at runtime so a deployment can point the client somewhere else
// without a rebuild (the production location is still open — workspace ledger
// #14/#30).
//
// Two deliberate choices:
// - Updates are never installed behind the user's back. A ready update is
//   applied when the user asks, or on the next real quit.
// - Nothing here may throw into startup. An unreachable feed is a status the
//   user can read, not a failure that touches the runtime.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
// electron-updater is CommonJS and the main bundle is ESM, so its named exports
// are not statically importable; take the default export and destructure.
import electronUpdater from 'electron-updater'
import { log } from './log'

const { autoUpdater } = electronUpdater

/** Where update work is at, as far as the user is concerned. */
export type UpdatePhase =
  /** Updates cannot run here (development build, or no feed configured). */
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  /** Downloaded and staged; installs on request or on the next quit. */
  | 'ready'
  | 'error'

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  /** Why updates are unsupported, when they are. */
  reason?: 'not-packaged' | 'no-feed'
  /** Version offered by the feed, once one is known. */
  availableVersion?: string
  /** Download progress in percent, while downloading. */
  percent?: number
  /** Failure detail from the last check or download. */
  message?: string
  /** ISO timestamp of the last completed check. */
  checkedAt?: string
}

/** First automatic check, once the runtime has settled. */
const FIRST_CHECK_DELAY_MS = 45_000

/** Interval between automatic checks. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let status: UpdateStatus = { phase: 'unsupported', currentVersion: '0.0.0', reason: 'not-packaged' }
let onChanged: (() => void) | undefined
let timer: NodeJS.Timeout | undefined
let configured = false

function setStatus(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  onChanged?.()
}

/**
 * Host the packaged feed points at while the distribution location is still
 * open (workspace ledger #31). A build carrying only this placeholder has no
 * real feed: saying so beats letting every client sit in a permanent "update
 * check failed", which reads like a defect rather than a pending decision.
 *
 * The sentinel uses the reserved .invalid TLD (RFC 2606) rather than a domain
 * anyone could own: it can never resolve, and it can never collide with the
 * real feed host, so pointing publish.url at the real host is enough to turn
 * updates on. Delete this constant once that happens.
 */
const PLACEHOLDER_FEED_HOST = 'updates.invalid'

/** What feed, if any, this client should use. */
export type FeedChoice =
  /** Use this URL, overriding whatever the build carries. */
  | { kind: 'override'; url: string }
  /** Use the feed the packaged build carries. */
  | { kind: 'packaged' }
  /** No feed: updates cannot run. */
  | { kind: 'none' }

/**
 * Decide the feed from the environment override and the packaged config.
 * Pure, so the precedence is testable without a packaged app.
 *
 * @param override - value of HARNESS_UPDATE_FEED_URL, if set.
 * @param config - contents of the packaged app-update.yml, if present.
 */
export function resolveFeed(override: string | undefined, config: string | undefined): FeedChoice {
  if (override !== undefined && override.trim() !== '') return { kind: 'override', url: override.trim() }
  if (config === undefined) return { kind: 'none' }
  return config.includes(PLACEHOLDER_FEED_HOST) ? { kind: 'none' } : { kind: 'packaged' }
}

function readPackagedFeedConfig(): string | undefined {
  // electron-builder writes app-update.yml next to the app resources when the
  // build has a publish provider; electron-updater reads it by itself.
  const path = join(process.resourcesPath, 'app-update.yml')
  if (!existsSync(path)) return undefined
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** Automatic checking is opt-out, but only where updates work at all. */
function autoCheckEnabled(): boolean {
  return process.env.HARNESS_UPDATE_AUTO !== '0'
}

export function updateStatus(): UpdateStatus {
  return status
}

/**
 * Wire the updater up. Safe to call unconditionally: in a development build,
 * or without a feed, it only records why updates are unavailable.
 */
export function initUpdater(options: { onChanged: () => void }): void {
  onChanged = options.onChanged
  const currentVersion = app.getVersion()

  if (!app.isPackaged) {
    status = { phase: 'unsupported', currentVersion, reason: 'not-packaged' }
    log.info('updater: disabled (development build)')
    return
  }
  const feed = resolveFeed(process.env.HARNESS_UPDATE_FEED_URL, readPackagedFeedConfig())
  if (feed.kind === 'none') {
    status = { phase: 'unsupported', currentVersion, reason: 'no-feed' }
    log.info('updater: disabled (no update feed configured)')
    return
  }

  status = { phase: 'idle', currentVersion }
  autoUpdater.logger = {
    info: (message: unknown) => { log.info(`updater: ${String(message)}`) },
    warn: (message: unknown) => { log.warn(`updater: ${String(message)}`) },
    error: (message: unknown) => { log.error(`updater: ${String(message)}`) },
    debug: () => { /* too chatty for the shell log */ },
  }
  // Downloading is fine unattended; installing is not.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  if (feed.kind === 'override') {
    autoUpdater.setFeedURL({ provider: 'generic', url: feed.url })
    log.info(`updater: feed overridden to ${feed.url}`)
  }

  autoUpdater.on('checking-for-update', () => { setStatus({ phase: 'checking', message: undefined }) })
  autoUpdater.on('update-available', (info) => {
    setStatus({ phase: 'available', availableVersion: info.version, percent: 0 })
    log.info(`updater: version ${info.version} available`)
  })
  autoUpdater.on('update-not-available', () => {
    setStatus({ phase: 'idle', availableVersion: undefined, checkedAt: new Date().toISOString() })
  })
  autoUpdater.on('download-progress', (progress) => {
    setStatus({ phase: 'downloading', percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ phase: 'ready', availableVersion: info.version, percent: 100 })
    log.info(`updater: version ${info.version} staged; will install on request or on quit`)
  })
  autoUpdater.on('error', (error) => {
    setStatus({ phase: 'error', message: error.message.slice(0, 300), checkedAt: new Date().toISOString() })
  })

  configured = true
  if (!autoCheckEnabled()) {
    log.info('updater: automatic checks disabled by HARNESS_UPDATE_AUTO=0')
    return
  }
  timer = setTimeout(() => {
    void checkForUpdates()
    timer = setInterval(() => { void checkForUpdates() }, CHECK_INTERVAL_MS)
  }, FIRST_CHECK_DELAY_MS)
}

/**
 * Ask the feed whether a newer build exists. Never rejects: a failure becomes
 * the error phase so the tray and the bridge can show it.
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!configured) return status
  // A staged update is the answer already; re-checking would restart the
  // download for nothing.
  if (status.phase === 'ready' || status.phase === 'downloading') return status
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setStatus({ phase: 'error', message: message.slice(0, 300), checkedAt: new Date().toISOString() })
  }
  return status
}

/**
 * Install a staged update now. Quits the app, so the caller must have nothing
 * left to flush.
 * @returns false when no update is staged.
 */
export function installUpdate(): boolean {
  if (status.phase !== 'ready') return false
  log.info('updater: installing staged update and restarting')
  // isSilent=false shows the installer, isForceRunAfter=true reopens the app.
  setImmediate(() => { autoUpdater.quitAndInstall(false, true) })
  return true
}

/** Stop the periodic check (called on shutdown). */
export function disposeUpdater(): void {
  if (timer !== undefined) clearTimeout(timer)
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
}
