// Application updates.
//
// electron-updater against the GitHub releases the release workflow publishes:
// the packaged build carries the feed written by electron-builder
// (`app-update.yml`), and `HARNESS_UPDATE_FEED_URL` overrides it at runtime with
// a generic feed, which is how the whole path is tested and how a private
// deployment runs without a rebuild.
//
// Four deliberate choices:
// - Updates are never installed behind the user's back. A ready update is
//   applied when the user asks, or on the next real quit.
// - The user is told once per version, when the download is already staged, so
//   the interruption comes with something to act on rather than a promise.
// - A check the user asked for always answers, including "you are up to date";
//   a check nobody asked for stays quiet unless it has news.
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
  /**
   * Whether a staged update will install when the app quits. True unless the
   * user cancelled this one — a cancel that left this on would be a lie, since
   * the download is already on disk and quitting would apply it.
   */
  installOnQuit?: boolean
  /** ISO timestamp of the last completed check. */
  checkedAt?: string
}

/** First automatic check, once the runtime has settled. */
const FIRST_CHECK_DELAY_MS = 45_000

/** Interval between automatic checks. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** What the shell gives the updater: a status sink and the two places it speaks. */
export interface UpdaterHost {
  /** Update state changed; the tray and any bridge reader should re-read it. */
  onChanged: () => void
  /**
   * A version is downloaded and ready. Called at most once per version per run,
   * because two of the three answers are already the standing behaviour and
   * asking again would only be nagging. The answer comes back through
   * {@link answerInstall}.
   */
  offerInstall: (version: string) => void
  /**
   * A check the user asked for has an answer — including "already up to date",
   * which is the answer they are most often looking for.
   */
  reportCheck: (status: UpdateStatus) => void
}

/** Why a check is running, which decides whether its outcome is announced. */
export type CheckIntent = 'auto' | 'manual'

/**
 * What the user answered when offered a staged update.
 * - `now` restarts and installs.
 * - `later` keeps it staged; it installs on the next real quit.
 * - `cancel` keeps it downloaded but stops it installing by itself. Not the
 *   same as `later`, and the difference is the whole reason there are three
 *   buttons: the bytes are already on disk, so a cancel that only closed the
 *   dialog would still install the update at quit time.
 */
export type InstallAnswer = 'now' | 'later' | 'cancel'

let status: UpdateStatus = { phase: 'unsupported', currentVersion: '0.0.0', reason: 'not-packaged' }
let host: UpdaterHost | undefined
let timer: NodeJS.Timeout | undefined
let configured = false
/** Version the user has already been offered, so the prompt never repeats. */
let offeredVersion: string | undefined

function setStatus(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  host?.onChanged()
}

/**
 * Sentinel host from before the distribution location was decided (workspace
 * ledger #31). Shipped builds now publish to GitHub releases and carry a real
 * feed, so this is no longer the normal case — it stays because a build can
 * still be configured with a generic provider and nowhere to point it, and a
 * client that says "no update server configured" beats one sitting in a
 * permanent "update check failed", which reads like a defect.
 *
 * The reserved .invalid TLD (RFC 2606) can never resolve and can never collide
 * with a real feed host.
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

/**
 * Whether this build should be offered pre-releases.
 *
 * Every 0.x release is published as a GitHub pre-release, and electron-updater
 * skips pre-releases by default — so a developer-preview client left on the
 * default would check faithfully, find nothing, forever. It follows the channel
 * it is already on: a 0.x or `-rc` build takes pre-releases because that is what
 * exists for it, and a 1.0.0 build does not, so the first stable release does
 * not silently opt its users into previews.
 *
 * Pure, so the rule is testable without a packaged app.
 *
 * @param version - the running application version.
 */
export function wantsPrereleases(version: string): boolean {
  return version.startsWith('0.') || version.includes('-')
}

export function updateStatus(): UpdateStatus {
  return status
}

/**
 * Wire the updater up. Safe to call unconditionally: in a development build,
 * or without a feed, it only records why updates are unavailable.
 */
export function initUpdater(options: UpdaterHost): void {
  host = options
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
  autoUpdater.allowPrerelease = wantsPrereleases(currentVersion)
  if (autoUpdater.allowPrerelease) log.info('updater: pre-releases accepted (this is a preview build)')
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
    // A newly staged version starts from the standing behaviour again: a cancel
    // applies to the version it was given for, not to updates in general.
    autoUpdater.autoInstallOnAppQuit = true
    setStatus({ phase: 'ready', availableVersion: info.version, percent: 100, installOnQuit: true })
    log.info(`updater: version ${info.version} staged; will install on request or on quit`)
    offerInstall(info.version)
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

/** Offer a staged version to the user, at most once per version per run. */
function offerInstall(version: string): void {
  if (offeredVersion === version) return
  offeredVersion = version
  host?.offerInstall(version)
}

/**
 * Ask the feed whether a newer build exists. Never rejects: a failure becomes
 * the error phase so the tray and the bridge can show it.
 *
 * @param intent - `manual` when a person asked, which is the only case that
 *   gets an answer they did not have to go looking for.
 */
export async function checkForUpdates(intent: CheckIntent = 'auto'): Promise<UpdateStatus> {
  if (!configured) {
    if (intent === 'manual') host?.reportCheck(status)
    return status
  }
  // A staged update is the answer already; re-checking would restart the
  // download for nothing. Asking again is how someone who dismissed the prompt
  // gets back to it, so the offer is repeated even though the check is not.
  if (status.phase === 'ready' || status.phase === 'downloading') {
    if (intent === 'manual') {
      offeredVersion = undefined
      if (status.phase === 'ready' && status.availableVersion !== undefined) {
        offerInstall(status.availableVersion)
      } else {
        host?.reportCheck(status)
      }
    }
    return status
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setStatus({ phase: 'error', message: message.slice(0, 300), checkedAt: new Date().toISOString() })
  }
  // Reported after the check settles, not after the download: "found 0.1.7,
  // downloading it now" is the honest answer at this point, and the download
  // announces itself again when it is ready to act on.
  if (intent === 'manual') host?.reportCheck(status)
  return status
}

/**
 * Record what the user answered when offered a staged update.
 *
 * `cancel` is the only one that changes anything: it turns off the install that
 * would otherwise happen at quit time. The download stays on disk, and the tray
 * row still installs it on request — cancelling one prompt is not the same as
 * refusing the version.
 *
 * @returns whether an install was started.
 */
export function answerInstall(answer: InstallAnswer): boolean {
  if (answer === 'now') return installUpdate()
  const version = status.availableVersion ?? 'the staged update'
  if (answer === 'cancel') {
    autoUpdater.autoInstallOnAppQuit = false
    setStatus({ installOnQuit: false })
    log.info(`updater: user cancelled ${version}; it stays downloaded and will not install by itself`)
  } else {
    autoUpdater.autoInstallOnAppQuit = true
    setStatus({ installOnQuit: true })
    log.info(`updater: user deferred ${version}; it installs on the next quit`)
  }
  return false
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
  offeredVersion = undefined
}
