// Local-only crash evidence.
//
// Electron's own crashes (main, renderer and GPU processes) never reach our
// logger: the process is gone before any JavaScript runs. Without Crashpad a
// crash leaves nothing behind at all, which for a product the user runs on
// their own machine — and reports remotely — means the trail ends there.
//
// Collection is strictly local: `uploadToServer: false`. Where crash reports
// would go is a product decision nobody has made (ledger #25 covers the server
// endpoint, and there is no telemetry consent flow), and a dump can contain
// fragments of process memory. Until that is decided, the dumps stay on the
// user's disk and support asks for them explicitly.

import { app, crashReporter } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './log'

/** Written while a run is in flight; its survival is the unclean-exit signal. */
const MARKER_FILE = 'run-marker.json'

interface RunMarker {
  readonly startedAt: string
  readonly pid: number
  readonly appVersion: string
  readonly dshVersion: string
}

function markerPath(): string {
  return join(app.getPath('userData'), MARKER_FILE)
}

/** Crashpad's report directory, as reported by Electron for this platform. */
function dumpDir(): string {
  return join(app.getPath('crashDumps'), 'reports')
}

/**
 * Start local Crashpad collection.
 *
 * Call before the app is ready: a crash during runtime mount is exactly the
 * kind we cannot otherwise see.
 *
 * @param dshVersion - runtime version, stamped so a dump can be tied to the
 *   locked dsh build it came from (workspace red line #2 pins that version, and
 *   a crash after an upgrade is the case worth telling apart).
 */
export function startCrashReporting(dshVersion: string): void {
  crashReporter.start({
    productName: 'Harness AI',
    uploadToServer: false,
    globalExtra: {
      appVersion: app.getVersion(),
      dshVersion,
      electron: process.versions.electron,
    },
  })
}

function countDumps(): number {
  try {
    return readdirSync(dumpDir()).filter((name) => name.endsWith('.dmp')).length
  } catch {
    // No directory until the first crash; absence is the common case.
    return 0
  }
}

function readMarker(): RunMarker | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(markerPath(), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const marker = parsed as Partial<RunMarker>
    if (typeof marker.startedAt !== 'string' || typeof marker.pid !== 'number') return undefined
    return {
      startedAt: marker.startedAt,
      pid: marker.pid,
      appVersion: typeof marker.appVersion === 'string' ? marker.appVersion : 'unknown',
      dshVersion: typeof marker.dshVersion === 'string' ? marker.dshVersion : 'unknown',
    }
  } catch {
    return undefined
  }
}

/**
 * Report whether the previous run ended cleanly, then claim the marker for this
 * one. A surviving marker means the last process died without reaching any of
 * our exit paths — a native crash, a kill, or a power loss.
 *
 * Call once, after the file log is open.
 *
 * @param dshVersion - runtime version recorded for this run.
 */
export function auditPreviousRun(dshVersion: string): void {
  const previous = readMarker()
  if (previous !== undefined) {
    log.warn(
      `previous run did not exit cleanly (started ${previous.startedAt}, pid ${String(previous.pid)}, `
      + `v${previous.appVersion}, dsh ${previous.dshVersion})`,
    )
  }
  const dumps = countDumps()
  // Surfaced every launch: support asks for this directory by name, and the
  // count tells the user whether there is anything in it worth sending.
  if (dumps > 0) log.warn(`${String(dumps)} local crash dump(s) in ${dumpDir()}`)
  const marker: RunMarker = {
    startedAt: new Date().toISOString(),
    pid: process.pid,
    appVersion: app.getVersion(),
    dshVersion,
  }
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(markerPath(), JSON.stringify(marker), 'utf8')
  } catch (error) {
    log.warn(`could not write the run marker: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Drop the marker so this run counts as clean. Every deliberate exit path has
 * to pass through here, including relaunches — `app.exit()` skips `will-quit`,
 * so there is no single teardown hook to hang this on.
 */
export function markCleanExit(): void {
  try {
    if (existsSync(markerPath())) rmSync(markerPath())
  } catch (error) {
    // A stale marker only costs one spurious warning next launch.
    log.warn(`could not clear the run marker: ${error instanceof Error ? error.message : String(error)}`)
  }
}
