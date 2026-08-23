import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  auditProfileBundles,
  forgetQuarantine,
  inspectBundle,
  profileOwnedBundles,
  quarantineBundles,
  readQuarantine,
  releaseQuarantine,
} from './profile-plugins'

vi.mock('../log', () => ({ log: { warn: () => {}, info: () => {}, error: () => {} } }))

let profileDir: string

function writeProfile(bundles: string[], dependencies: Record<string, string> = {}): void {
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-desktop', dependencies, dsh: { profile: { bundles } } }, undefined, 2),
  )
}

/** Lay down a package in the profile's node_modules. */
function writePackage(
  name: string,
  options: { patch?: string | null; patchFileExists?: boolean; manifest?: string } = {},
): void {
  const dir = join(profileDir, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  if (options.manifest !== undefined) {
    writeFileSync(join(dir, 'package.json'), options.manifest)
    return
  }
  const patch = options.patch === undefined ? './cordis.patch.yml' : options.patch
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', ...(patch === null ? {} : { dsh: { bundle: { patch } } }) }),
  )
  if (patch !== null && options.patchFileExists !== false) writeFileSync(join(dir, patch), '[]\n')
}

function bundlesOf(): string[] {
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
  }
  return manifest.dsh?.profile?.bundles ?? []
}

beforeEach(() => {
  profileDir = mkdtempSync(join(tmpdir(), 'harness-profile-'))
})

afterEach(() => {
  rmSync(profileDir, { recursive: true, force: true })
})

describe('profileOwnedBundles', () => {
  it('excludes the template bundles that ship inside the installation', () => {
    writeProfile(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-memo'])
    expect(profileOwnedBundles(profileDir)).toEqual(['dsh-memo'])
  })

  it('is empty for a profile that has no manifest yet', () => {
    expect(profileOwnedBundles(profileDir)).toEqual([])
  })
})

describe('inspectBundle', () => {
  it('accepts a well-formed plugin', () => {
    writePackage('dsh-memo')
    expect(inspectBundle(profileDir, 'dsh-memo')).toBeUndefined()
  })

  it('reports a package that is not installed', () => {
    expect(inspectBundle(profileDir, 'dsh-memo')).toBe('package-missing')
  })

  it('reports a package that declares no bundle patch', () => {
    writePackage('dsh-memo', { patch: null })
    expect(inspectBundle(profileDir, 'dsh-memo')).toBe('not-a-plugin')
  })

  it('reports a bundle patch file that is missing', () => {
    writePackage('dsh-memo', { patchFileExists: false })
    expect(inspectBundle(profileDir, 'dsh-memo')).toBe('patch-missing')
  })

  it('reports an unreadable manifest', () => {
    writePackage('dsh-memo', { manifest: '{ not json' })
    expect(inspectBundle(profileDir, 'dsh-memo')).toBe('manifest-unreadable')
  })

  it('handles scoped package names', () => {
    writePackage('@acme/dsh-thing')
    expect(inspectBundle(profileDir, '@acme/dsh-thing')).toBeUndefined()
  })
})

describe('auditProfileBundles', () => {
  it('leaves a healthy profile untouched', () => {
    writeProfile(['@deepseek-ai/dsh-base', 'dsh-memo'], { 'dsh-memo': '1.0.0' })
    writePackage('dsh-memo')
    expect(auditProfileBundles(profileDir)).toEqual([])
    expect(bundlesOf()).toEqual(['@deepseek-ai/dsh-base', 'dsh-memo'])
    expect(readQuarantine(profileDir)).toEqual([])
  })

  it('disables a plugin whose package vanished, and keeps the rest', () => {
    writeProfile(['@deepseek-ai/dsh-base', 'dsh-memo', 'dsh-good'], { 'dsh-memo': '1.0.0', 'dsh-good': '1.0.0' })
    writePackage('dsh-good')
    const disabled = auditProfileBundles(profileDir)
    expect(disabled.map((entry) => entry.name)).toEqual(['dsh-memo'])
    expect(disabled[0]?.reason).toBe('package-missing')
    expect(bundlesOf()).toEqual(['@deepseek-ai/dsh-base', 'dsh-good'])
  })

  it('never disables an installation-provided bundle', () => {
    // Nothing is installed at all, so only the profile-owned name may go.
    writeProfile(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-memo'])
    auditProfileBundles(profileDir)
    expect(bundlesOf()).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  })

  it('is idempotent across restarts', () => {
    writeProfile(['dsh-memo'], { 'dsh-memo': '1.0.0' })
    auditProfileBundles(profileDir)
    expect(auditProfileBundles(profileDir)).toEqual([])
    expect(readQuarantine(profileDir)).toHaveLength(1)
  })

  it('keeps the dependency entry so the user can still repair it', () => {
    writeProfile(['dsh-memo'], { 'dsh-memo': '1.0.0' })
    auditProfileBundles(profileDir)
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies).toEqual({ 'dsh-memo': '1.0.0' })
  })
})

describe('quarantineBundles', () => {
  it('records the reason and the time', () => {
    writeProfile(['dsh-memo'])
    quarantineBundles(profileDir, ['dsh-memo'], 'boot-failed', () => new Date('2026-08-23T10:00:00.000Z'))
    expect(readQuarantine(profileDir)).toEqual([
      { name: 'dsh-memo', reason: 'boot-failed', at: '2026-08-23T10:00:00.000Z' },
    ])
  })

  it('reports nothing when the name is not an active bundle', () => {
    writeProfile(['dsh-other'])
    expect(quarantineBundles(profileDir, ['dsh-memo'], 'boot-failed')).toEqual([])
  })

  it('replaces an earlier record instead of duplicating it', () => {
    writeProfile(['dsh-memo'])
    quarantineBundles(profileDir, ['dsh-memo'], 'package-missing')
    writeProfile(['dsh-memo'])
    quarantineBundles(profileDir, ['dsh-memo'], 'boot-failed')
    const entries = readQuarantine(profileDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.reason).toBe('boot-failed')
  })
})

describe('releaseQuarantine', () => {
  it('restores a plugin that was repaired', () => {
    writeProfile(['dsh-memo'], { 'dsh-memo': '1.0.0' })
    auditProfileBundles(profileDir)
    expect(bundlesOf()).toEqual([])

    writePackage('dsh-memo')
    expect(releaseQuarantine(profileDir, 'dsh-memo')).toBe(true)
    expect(bundlesOf()).toEqual(['dsh-memo'])
    expect(readQuarantine(profileDir)).toEqual([])
  })

  it('refuses to restore a plugin that is still broken', () => {
    writeProfile(['dsh-memo'], { 'dsh-memo': '1.0.0' })
    auditProfileBundles(profileDir)
    expect(releaseQuarantine(profileDir, 'dsh-memo')).toBe(false)
    expect(bundlesOf()).toEqual([])
  })

  it('keeps the record when the restore is refused, so the plugin stays visible', () => {
    // Dropping it here would leave the plugin disabled with nothing on screen
    // saying so — a silently degraded client.
    writeProfile(['dsh-memo'], { 'dsh-memo': '1.0.0' })
    auditProfileBundles(profileDir)
    releaseQuarantine(profileDir, 'dsh-memo')
    expect(readQuarantine(profileDir).map((entry) => entry.name)).toEqual(['dsh-memo'])
  })
})

describe('forgetQuarantine', () => {
  it('drops the record of a plugin that was uninstalled', () => {
    writeProfile(['dsh-memo'], { 'dsh-memo': '1.0.0' })
    auditProfileBundles(profileDir)
    forgetQuarantine(profileDir, 'dsh-memo')
    expect(readQuarantine(profileDir)).toEqual([])
    expect(bundlesOf()).toEqual([])
  })
})
