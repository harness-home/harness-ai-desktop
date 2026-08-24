import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBootWatchdog } from './boot-watchdog'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createBootWatchdog', () => {
  it('trips when nothing reports progress', () => {
    const onTimeout = vi.fn()
    const gate = createBootWatchdog({ stallMs: 1000, ceilingMs: 10_000, onTimeout })
    vi.advanceTimersByTime(999)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(gate.tripped()).toBe(true)
  })

  it('gives a slow but progressing boot as long as it needs', () => {
    // The case a flat budget got wrong: 27 seconds of real work that never
    // goes quiet.
    const onTimeout = vi.fn()
    const gate = createBootWatchdog({ stallMs: 1000, ceilingMs: 600_000, onTimeout })
    for (let tick = 0; tick < 40; tick += 1) {
      vi.advanceTimersByTime(900)
      gate.progress(`fiber-${String(tick)}`)
    }
    expect(onTimeout).not.toHaveBeenCalled()
    expect(gate.tripped()).toBe(false)
  })

  it('names what last reported progress', () => {
    const onTimeout = vi.fn()
    createBootWatchdog({ stallMs: 1000, ceilingMs: 10_000, onTimeout }).progress('profile-compose')
    vi.advanceTimersByTime(1001)
    expect(onTimeout).toHaveBeenCalledWith(expect.stringContaining('profile-compose'))
    expect(onTimeout).toHaveBeenCalledWith(expect.stringContaining('no startup progress'))
  })

  it('still trips at the ceiling when progress never stops', () => {
    // A boot that keeps ticking but never finishes must still report.
    const onTimeout = vi.fn()
    const gate = createBootWatchdog({ stallMs: 1000, ceilingMs: 5000, onTimeout })
    for (let tick = 0; tick < 20; tick += 1) {
      vi.advanceTimersByTime(500)
      gate.progress()
    }
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onTimeout).toHaveBeenCalledWith(expect.stringContaining('exceeded'))
  })

  it('reports only once', () => {
    const onTimeout = vi.fn()
    createBootWatchdog({ stallMs: 1000, ceilingMs: 2000, onTimeout })
    vi.advanceTimersByTime(60_000)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('stays quiet after stop', () => {
    const onTimeout = vi.fn()
    const gate = createBootWatchdog({ stallMs: 1000, ceilingMs: 5000, onTimeout })
    gate.stop()
    vi.advanceTimersByTime(60_000)
    expect(onTimeout).not.toHaveBeenCalled()
    expect(gate.tripped()).toBe(false)
  })

  it('ignores progress reported after it already tripped', () => {
    const onTimeout = vi.fn()
    const gate = createBootWatchdog({ stallMs: 1000, ceilingMs: 10_000, onTimeout })
    vi.advanceTimersByTime(1001)
    gate.progress('late')
    vi.advanceTimersByTime(60_000)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('tolerates stop after tripping', () => {
    const onTimeout = vi.fn()
    const gate = createBootWatchdog({ stallMs: 1000, ceilingMs: 10_000, onTimeout })
    vi.advanceTimersByTime(1001)
    expect(() => gate.stop()).not.toThrow()
    expect(gate.tripped()).toBe(true)
  })
})
