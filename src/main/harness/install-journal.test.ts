import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginOperation,
  completeOperation,
  readJournal,
  recoverIncompleteInstall,
  rollback,
} from './install-journal'

vi.mock('../log', () => ({ log: { warn: () => {}, info: () => {}, error: () => {} } }))

let profileDir: string

const ORIGINAL = JSON.stringify(
  { name: 'dsh-profile-desktop', dependencies: {}, dsh: { profile: { bundles: ['dsh-base'] } } },
  undefined,
  2,
) + '\n'

/** What the manifest looks like after a half-finished install. */
const MUTATED = JSON.stringify(
  {
    name: 'dsh-profile-desktop',
    dependencies: { 'dsh-plugin-hello': '0.1.0' },
    dsh: { profile: { bundles: ['dsh-base', 'dsh-plugin-hello'] } },
  },
  undefined,
  2,
) + '\n'

function manifest(): string {
  return readFileSync(join(profileDir, 'package.json'), 'utf8')
}

beforeEach(() => {
  profileDir = mkdtempSync(join(tmpdir(), 'harness-journal-'))
  writeFileSync(join(profileDir, 'package.json'), ORIGINAL)
})
afterEach(() => {
  rmSync(profileDir, { recursive: true, force: true })
})

describe('beginOperation', () => {
  it('journals the manifest as it was', () => {
    expect(beginOperation(profileDir, 'install', 'dsh-plugin-hello', '0.1.0')).toBe(true)
    const entry = readJournal(profileDir)
    expect(entry?.operation).toBe('install')
    expect(entry?.packageName).toBe('dsh-plugin-hello')
    expect(entry?.version).toBe('0.1.0')
    expect(entry?.priorManifest).toBe(ORIGINAL)
  })

  it('reports failure when there is no manifest to journal', () => {
    rmSync(join(profileDir, 'package.json'))
    expect(beginOperation(profileDir, 'install', 'p', '1.0.0')).toBe(false)
    expect(readJournal(profileDir)).toBeUndefined()
  })
})

describe('completeOperation', () => {
  it('clears the journal so the change is committed', () => {
    beginOperation(profileDir, 'install', 'dsh-plugin-hello', '0.1.0')
    writeFileSync(join(profileDir, 'package.json'), MUTATED)
    completeOperation(profileDir)
    expect(readJournal(profileDir)).toBeUndefined()
    expect(manifest()).toBe(MUTATED)
  })

  it('is safe to call with no journal present', () => {
    expect(() => completeOperation(profileDir)).not.toThrow()
  })
})

describe('rollback', () => {
  it('restores the exact prior manifest bytes', () => {
    beginOperation(profileDir, 'install', 'dsh-plugin-hello', '0.1.0')
    writeFileSync(join(profileDir, 'package.json'), MUTATED)
    const entry = rollback(profileDir)
    expect(entry?.packageName).toBe('dsh-plugin-hello')
    expect(manifest()).toBe(ORIGINAL)
    expect(readJournal(profileDir)).toBeUndefined()
  })

  it('does nothing when there is no journal', () => {
    writeFileSync(join(profileDir, 'package.json'), MUTATED)
    expect(rollback(profileDir)).toBeUndefined()
    expect(manifest()).toBe(MUTATED)
  })

  it('leaves node_modules alone', () => {
    // Deleting trees during recovery turns a bad state into an unrecoverable
    // one; an unreferenced package is inert.
    const installed = join(profileDir, 'node_modules')
    writeFileSync(join(profileDir, 'stray.txt'), 'x')
    beginOperation(profileDir, 'install', 'p', '1.0.0')
    rollback(profileDir)
    expect(existsSync(join(profileDir, 'stray.txt'))).toBe(true)
    expect(existsSync(installed)).toBe(false)
  })
})

describe('recoverIncompleteInstall', () => {
  it('undoes an operation that never completed', () => {
    beginOperation(profileDir, 'install', 'dsh-plugin-hello', '0.1.0')
    writeFileSync(join(profileDir, 'package.json'), MUTATED)
    // Simulates the process dying here.
    const entry = recoverIncompleteInstall(profileDir)
    expect(entry?.packageName).toBe('dsh-plugin-hello')
    expect(manifest()).toBe(ORIGINAL)
  })

  it('is a no-op after a completed operation', () => {
    beginOperation(profileDir, 'install', 'dsh-plugin-hello', '0.1.0')
    writeFileSync(join(profileDir, 'package.json'), MUTATED)
    completeOperation(profileDir)
    expect(recoverIncompleteInstall(profileDir)).toBeUndefined()
    expect(manifest()).toBe(MUTATED)
  })

  it('ignores a corrupted journal instead of restoring garbage', () => {
    writeFileSync(join(profileDir, 'harness-install-journal.json'), '{ not json')
    writeFileSync(join(profileDir, 'package.json'), MUTATED)
    expect(recoverIncompleteInstall(profileDir)).toBeUndefined()
    expect(manifest()).toBe(MUTATED)
  })

  it('ignores a journal missing the prior manifest', () => {
    writeFileSync(
      join(profileDir, 'harness-install-journal.json'),
      JSON.stringify({ operation: 'install', packageName: 'p', startedAt: 'now' }),
    )
    expect(recoverIncompleteInstall(profileDir)).toBeUndefined()
    expect(manifest()).toBe(ORIGINAL)
  })
})
