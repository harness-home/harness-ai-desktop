// Named startup stages.
//
// Kept dependency-free so the ordering rules can be unit tested without an
// Electron app (same reason as picker-overlay.ts).
//
// Why this exists: startup used to be three states — starting, ready, failed —
// and a failure handed the user a raw stack. When the packaged 0.1.3 build died
// on launch under `D:\Program Files`, telling `runtime-boot` apart from
// `profile-compose` was the whole diagnosis, and it took reading the log to do
// it. The stage is a diagnostic identifier, not prose: it stays English and
// untranslated on both the failure surface and in support reports.

/**
 * Startup stages in the order a healthy launch passes through them.
 *
 * The `dsh-*` through `webserver-bind` stages are reported by the runtime
 * adapter, which is the only place allowed to know those concepts (workspace
 * red line #3); everything else is set by the shell.
 */
export const STARTUP_STAGES = [
  'app-ready',
  'window-create',
  'dsh-home',
  'profile-audit',
  'profile-compose',
  'runtime-boot',
  'webserver-bind',
  'hosting-bridge',
  'renderer-load',
  'ready',
] as const

export type StartupStage = (typeof STARTUP_STAGES)[number]

interface StageEntry {
  readonly stage: StartupStage
  readonly at: number
}

let entries: StageEntry[] = []
let clock: () => number = () => Date.now()
let sink: ((line: string) => void) | undefined

/**
 * Route stage transitions to the shell log.
 *
 * Injected rather than imported so this module stays free of Electron: the
 * logger reaches `app.getPath`, which no unit test can provide.
 *
 * @param write - log sink, or `undefined` to stop reporting.
 */
export function setStageLogger(write: ((line: string) => void) | undefined): void {
  sink = write
}

/**
 * Record entry into a stage.
 *
 * Re-entering an earlier stage is legitimate, not an error: a boot that fails
 * with profile plugins active is retried without them, which walks the runtime
 * stages a second time.
 *
 * @param stage - stage now being entered.
 * @returns milliseconds spent in the preceding stage, or 0 for the first one.
 */
export function enterStage(stage: StartupStage): number {
  const now = clock()
  const previous = entries.at(-1)
  entries.push({ stage, at: now })
  const elapsed = previous === undefined ? 0 : now - previous.at
  sink?.(`startup stage: ${stage} (previous stage took ${String(elapsed)}ms)`)
  return elapsed
}

/** The stage most recently entered, or `undefined` before the first one. */
export function currentStage(): StartupStage | undefined {
  return entries.at(-1)?.stage
}

/**
 * Compact per-stage timing for one log line, e.g.
 * `app-ready +0ms > runtime-boot +2140ms`.
 *
 * The 45s health gate exists because cold starts on slow disks were missing a
 * 30s one; when it trips again, this says which stage ate the budget.
 *
 * @returns the timeline, or `'(none)'` when no stage was entered.
 */
export function startupTimeline(): string {
  if (entries.length === 0) return '(none)'
  const start = entries[0]?.at ?? 0
  return entries.map((entry) => `${entry.stage} +${String(entry.at - start)}ms`).join(' > ')
}

/**
 * Reset recorded stages. Test seam only.
 *
 * @param now - clock replacing `Date.now`.
 */
export function resetStartupStages(now: () => number = () => Date.now()): void {
  entries = []
  clock = now
  sink = undefined
}
