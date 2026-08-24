// Startup health gate.
//
// It used to be a flat timeout, and a flat timeout cannot be set correctly. The
// history says so: 30s was too short for a cold start on a slow disk, 45s was
// too short again when the machine was compiling something else at the same
// time, and every raise made a genuinely wedged boot take longer to report. The
// number was standing in for a question it cannot answer — is this boot still
// getting somewhere?
//
// Progress is observable: the shell reports stage transitions, and the runtime's
// plugin tree emits a lifecycle event per fiber (156 of them on this profile),
// so a healthy boot is never quiet for long even during the 27-second stretch
// that has no stage change of its own. So the gate watches for silence instead
// of duration: a boot that keeps reporting gets as long as it needs, and one
// that stops reporting fails in seconds rather than in whatever the flat budget
// happened to be. A ceiling stays as the backstop for the case this cannot
// see — a boot that keeps ticking forever without ever finishing.

/** No sign of progress for this long means the boot is stuck, not slow. */
export const DEFAULT_STALL_MS = 20_000

/** Absolute cap; a livelocked boot still reports rather than hanging forever. */
export const DEFAULT_CEILING_MS = 180_000

export interface BootWatchdogOptions {
  stallMs?: number
  ceilingMs?: number
  /** Called once, with why the gate tripped. Never called after `stop()`. */
  onTimeout: (reason: string) => void
  /** Timer seams, so the gate can be tested without waiting for it. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface BootWatchdog {
  /** Report that startup moved forward; resets the stall window. */
  progress: (label?: string) => void
  /** Stop watching. Idempotent, and safe after the gate has tripped. */
  stop: () => void
  /** Whether the gate has already tripped. */
  tripped: () => boolean
}

export function createBootWatchdog(options: BootWatchdogOptions): BootWatchdog {
  const stallMs = options.stallMs ?? DEFAULT_STALL_MS
  const ceilingMs = options.ceilingMs ?? DEFAULT_CEILING_MS
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer
    ?? ((handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>) })

  let stallTimer: unknown
  let ceilingTimer: unknown
  let finished = false
  let timedOut = false
  /** Last thing that reported progress, so the failure says where it stopped. */
  let lastLabel = 'startup'

  const settle = (): void => {
    finished = true
    clearTimer(stallTimer)
    clearTimer(ceilingTimer)
  }

  const trip = (reason: string): void => {
    if (finished) return
    settle()
    timedOut = true
    options.onTimeout(reason)
  }

  const armStall = (): void => {
    clearTimer(stallTimer)
    stallTimer = setTimer(() => {
      trip(`no startup progress for ${String(Math.round(stallMs / 1000))}s (last: ${lastLabel})`)
    }, stallMs)
  }

  ceilingTimer = setTimer(() => {
    trip(`startup exceeded ${String(Math.round(ceilingMs / 1000))}s in total (last: ${lastLabel})`)
  }, ceilingMs)
  armStall()

  return {
    progress: (label) => {
      if (finished) return
      if (label !== undefined && label !== '') lastLabel = label
      armStall()
    },
    stop: settle,
    tripped: () => timedOut,
  }
}
