import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  evaluateWorkspaceLocation,
  isNetworkPath,
  nodeWorkspaceProbe,
  type WorkspaceProbe,
} from './workspace-location'

const capable: WorkspaceProbe = { writable: () => true, junctions: () => true }
const readOnly: WorkspaceProbe = { writable: () => false, junctions: () => true }
const noJunctions: WorkspaceProbe = { writable: () => true, junctions: () => false }

describe('network paths', () => {
  it('treats UNC shares as network', () => {
    expect(isNetworkPath('\\\\server\\share\\work')).toBe(true)
    expect(isNetworkPath('//server/share/work')).toBe(true)
  })

  it('accepts the extended UNC form', () => {
    expect(isNetworkPath('\\\\?\\UNC\\server\\share')).toBe(true)
  })

  it('does not mistake the local device namespace for a share', () => {
    expect(isNetworkPath('\\\\?\\C:\\work')).toBe(false)
    expect(isNetworkPath('C:\\work')).toBe(false)
  })
})

describe('workspace admission', () => {
  it('leaves non-Windows platforms alone', () => {
    expect(evaluateWorkspaceLocation('darwin', '/Users/me/work', readOnly))
      .toEqual({ verdict: 'allow' })
  })

  it('blocks a network share before probing it', () => {
    const exploded: WorkspaceProbe = {
      writable: () => { throw new Error('probe must not run on a share') },
      junctions: () => { throw new Error('probe must not run on a share') },
    }
    expect(evaluateWorkspaceLocation('win32', '\\\\nas\\team', exploded))
      .toEqual({ verdict: 'block', concern: 'network-share' })
  })

  it('blocks a directory it cannot write to', () => {
    expect(evaluateWorkspaceLocation('win32', 'C:\\work', readOnly))
      .toEqual({ verdict: 'block', concern: 'not-writable' })
  })

  it('asks rather than refuses when junctions are unsupported', () => {
    expect(evaluateWorkspaceLocation('win32', 'E:\\stick', noJunctions))
      .toEqual({ verdict: 'confirm', concern: 'no-junction-support' })
  })

  it('allows a fully capable directory', () => {
    expect(evaluateWorkspaceLocation('win32', 'C:\\work', capable))
      .toEqual({ verdict: 'allow' })
  })
})

describe('filesystem probe', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-probe-test-'))
  afterAll(() => { rmSync(root, { recursive: true, force: true }) })

  it('reports a writable temp directory as usable', () => {
    expect(nodeWorkspaceProbe().writable(root)).toBe(true)
  })

  it('reports a missing directory as unusable', () => {
    expect(nodeWorkspaceProbe().writable(join(root, 'absent'))).toBe(false)
  })

  it('leaves nothing behind', () => {
    const probe = nodeWorkspaceProbe()
    probe.writable(root)
    probe.junctions(root)
    expect(readdirSync(root)).toEqual([])
  })
})
