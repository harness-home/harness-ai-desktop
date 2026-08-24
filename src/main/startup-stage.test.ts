import { beforeEach, describe, expect, it } from 'vitest'
import {
  currentStage,
  enterStage,
  resetStartupStages,
  setStageLogger,
  STARTUP_STAGES,
  startupTimeline,
} from './startup-stage'

let now = 0

beforeEach(() => {
  now = 0
  resetStartupStages(() => now)
})

describe('startup stages', () => {
  it('names every stage once', () => {
    expect(new Set(STARTUP_STAGES).size).toBe(STARTUP_STAGES.length)
  })

  it('reports nothing before the first stage', () => {
    expect(currentStage()).toBeUndefined()
    expect(startupTimeline()).toBe('(none)')
  })

  it('tracks the stage in flight', () => {
    enterStage('app-ready')
    enterStage('window-create')
    expect(currentStage()).toBe('window-create')
  })

  it('measures the stage just left', () => {
    expect(enterStage('app-ready')).toBe(0)
    now = 40
    expect(enterStage('window-create')).toBe(40)
    now = 2180
    expect(enterStage('runtime-boot')).toBe(2140)
  })

  it('keeps both passes when a failed boot is retried without profile plugins', () => {
    enterStage('runtime-boot')
    now = 900
    enterStage('profile-compose')
    now = 1000
    enterStage('runtime-boot')
    expect(currentStage()).toBe('runtime-boot')
    expect(startupTimeline()).toBe(
      'runtime-boot +0ms > profile-compose +900ms > runtime-boot +1000ms',
    )
  })

  it('reports each transition to an injected sink', () => {
    const lines: string[] = []
    setStageLogger((line) => lines.push(line))
    enterStage('app-ready')
    now = 40
    enterStage('window-create')
    expect(lines).toEqual([
      'startup stage: app-ready (previous stage took 0ms)',
      'startup stage: window-create (previous stage took 40ms)',
    ])
  })

  it('stops reporting once the sink is cleared', () => {
    const lines: string[] = []
    setStageLogger((line) => lines.push(line))
    enterStage('app-ready')
    setStageLogger(undefined)
    enterStage('window-create')
    expect(lines).toHaveLength(1)
  })
})
