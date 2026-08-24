import { describe, expect, it } from 'vitest'
import { BootProfiler, formatBootProfile, type ProfiledFiber } from './boot-profile'

const PENDING = 0
const LOADING = 1
const ACTIVE = 2
const FAILED = 3

function fiber(uid: number, state: number, name?: string): ProfiledFiber {
  return { uid, state, runtime: name === undefined ? null : { name } }
}

describe('boot profiler', () => {
  it('times a fiber from loading to active', () => {
    let now = 0
    const profiler = new BootProfiler(() => now)
    profiler.record(fiber(1, LOADING, 'agent-loop'), PENDING)
    now = 250
    profiler.record(fiber(1, ACTIVE, 'agent-loop'), LOADING)
    expect(profiler.profile()).toEqual({
      fiberCount: 1,
      totalLoadMs: 250,
      slowest: [{ label: 'agent-loop', ms: 250, failed: false }],
    })
  })

  it('still times a fiber whose plugin threw', () => {
    let now = 0
    const profiler = new BootProfiler(() => now)
    profiler.record(fiber(2, LOADING, 'broken'), PENDING)
    now = 40
    profiler.record(fiber(2, FAILED, 'broken'), LOADING)
    expect(profiler.profile().slowest[0]).toEqual({ label: 'broken', ms: 40, failed: true })
  })

  it('ignores transitions that never passed through loading', () => {
    const profiler = new BootProfiler(() => 0)
    profiler.record(fiber(3, ACTIVE, 'x'), PENDING)
    expect(profiler.profile().fiberCount).toBe(0)
  })

  it('ignores a disposed fiber with no uid', () => {
    const profiler = new BootProfiler(() => 0)
    profiler.record({ uid: null, state: LOADING, runtime: null }, PENDING)
    expect(profiler.profile().fiberCount).toBe(0)
  })

  it('labels an anonymous fiber by uid', () => {
    let now = 0
    const profiler = new BootProfiler(() => now)
    profiler.record(fiber(7, LOADING), PENDING)
    now = 5
    profiler.record(fiber(7, ACTIVE), LOADING)
    expect(profiler.profile().slowest[0]?.label).toBe('fiber#7')
  })

  it('ranks the slowest first and keeps only the requested count', () => {
    let now = 0
    const profiler = new BootProfiler(() => now)
    for (const [uid, cost] of [[1, 10], [2, 90], [3, 50]] as const) {
      profiler.record(fiber(uid, LOADING, `p${String(uid)}`), PENDING)
      now += cost
      profiler.record(fiber(uid, ACTIVE, `p${String(uid)}`), LOADING)
    }
    const profile = profiler.profile(2)
    expect(profile.slowest.map((timing) => timing.label)).toEqual(['p2', 'p3'])
    expect(profile.totalLoadMs).toBe(150)
    expect(profile.fiberCount).toBe(3)
  })
})

describe('boot profile line', () => {
  it('contrasts plugin time against the stage wall clock', () => {
    const line = formatBootProfile({
      fiberCount: 2,
      totalLoadMs: 300,
      slowest: [{ label: 'slow', ms: 200, failed: false }],
    }, 3000)
    expect(line).toBe(
      'boot profile: 2 fibers, 300ms inclusive vs 3000ms wall (10%); '
      + 'slowest (inclusive of nested): slow 200ms',
    )
  })

  it('marks a failed fiber in the line', () => {
    const line = formatBootProfile({
      fiberCount: 1,
      totalLoadMs: 5,
      slowest: [{ label: 'broken', ms: 5, failed: true }],
    }, 10)
    expect(line).toContain('broken(failed) 5ms')
  })

  it('survives an empty profile', () => {
    const line = formatBootProfile({ fiberCount: 0, totalLoadMs: 0, slowest: [] }, 0)
    expect(line).toContain('slowest (inclusive of nested): (none)')
  })
})
