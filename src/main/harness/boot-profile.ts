// Boot profiler: where the runtime-boot stage actually spends its time.
//
// The stage timeline showed runtime-boot taking ~27s, which is a number with
// nowhere to go: `boot()` is dsh's, and the tree it mounts is dozens of plugin
// fibers deep. Rather than patch the framework to find out (workspace red line
// #1 would make that a registered patch), this listens to the Cordis lifecycle
// event every fiber already emits — a plain subscription on the host context,
// tier-one plugin territory.
//
// The number worth having is not just the slowest plugin. It is how much of the
// stage the fibers account for at all: if they sum to a fraction of the wall
// clock, the rest is module resolution and ESM import, and that points at a
// completely different fix from a slow plugin.

/** Cordis FiberState values this profiler cares about. */
const LOADING = 1
const ACTIVE = 2
const FAILED = 3

/** The part of a Cordis fiber the profiler reads. */
export interface ProfiledFiber {
  readonly uid: number | null
  readonly state: number
  readonly runtime: { readonly name?: string } | null
}

export interface FiberTiming {
  readonly label: string
  readonly ms: number
  readonly failed: boolean
}

export interface BootProfile {
  /** Fibers that finished loading, successfully or not. */
  readonly fiberCount: number
  /** Wall time inside plugin callbacks, summed. */
  readonly totalLoadMs: number
  readonly slowest: readonly FiberTiming[]
}

/**
 * Collects fiber load timings from `internal/status` transitions.
 *
 * Fibers load concurrently, so `totalLoadMs` is a sum of overlapping intervals
 * and can exceed the wall clock. It answers "how much work was there", not
 * "how long did it take"; the stage timeline answers the second.
 */
export class BootProfiler {
  private readonly startedAt = new Map<number, number>()
  private readonly timings: FiberTiming[] = []

  constructor(private readonly clock: () => number = () => Date.now()) {}

  /**
   * Record one lifecycle transition.
   *
   * @param fiber - the fiber that changed state.
   * @param oldState - the state it left.
   */
  record(fiber: ProfiledFiber, oldState: number): void {
    const uid = fiber.uid
    if (uid === null) return
    if (fiber.state === LOADING) {
      this.startedAt.set(uid, this.clock())
      return
    }
    if (oldState !== LOADING) return
    if (fiber.state !== ACTIVE && fiber.state !== FAILED) return
    const started = this.startedAt.get(uid)
    if (started === undefined) return
    this.startedAt.delete(uid)
    this.timings.push({
      label: fiber.runtime?.name ?? `fiber#${String(uid)}`,
      ms: this.clock() - started,
      failed: fiber.state === FAILED,
    })
  }

  /**
   * Summarise what was collected.
   *
   * @param top - how many of the slowest fibers to include.
   * @returns the profile.
   */
  profile(top = 5): BootProfile {
    const slowest = [...this.timings].sort((a, b) => b.ms - a.ms).slice(0, top)
    return {
      fiberCount: this.timings.length,
      totalLoadMs: this.timings.reduce((sum, timing) => sum + timing.ms, 0),
      slowest,
    }
  }
}

/**
 * One log line: how much of the stage the fibers explain, then the worst few.
 *
 * Timings are **inclusive** — a fiber that mounts children carries their time
 * too. A container whose time approaches the wall clock (the loader's root
 * include is one) is not a slow plugin; it is the thing the next entries sit
 * inside, and the cost is the tree it resolves and imports.
 *
 * @param profile - collected profile.
 * @param stageMs - wall time of the runtime-boot stage.
 * @returns the formatted line.
 */
export function formatBootProfile(profile: BootProfile, stageMs: number): string {
  const worst = profile.slowest
    .map((timing) => `${timing.label}${timing.failed ? '(failed)' : ''} ${String(timing.ms)}ms`)
    .join(', ')
  // Concurrency makes the ratio a rough weight, not a percentage of the clock.
  const share = stageMs > 0 ? Math.round((profile.totalLoadMs / stageMs) * 100) : 0
  return `boot profile: ${String(profile.fiberCount)} fibers, `
    + `${String(profile.totalLoadMs)}ms inclusive vs ${String(stageMs)}ms wall (${String(share)}%); `
    + `slowest (inclusive of nested): ${worst === '' ? '(none)' : worst}`
}
