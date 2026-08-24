import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fetchPackument } from './install-guard'
import { readJournal } from './install-journal'
import { installPlugin, installedPlugins, uninstallPlugin } from './plugin-install'

// Live install verification: runs the real gated install path against the real
// npm registry, into a throwaway profile.
//
// Kept out of `pnpm test` (which must stay offline and fast) and run by
// `pnpm test:e2e`. Everything the unit tests mock — the registry, pnpm, the
// filesystem — is real here, because the failure modes worth catching in this
// path only appear when all three are.

vi.mock('../log', () => ({ log: { warn: () => {}, info: () => {}, error: () => {} } }))

const APP_ROOT = process.cwd()
const PACKAGE = process.env.HARNESS_E2E_PACKAGE ?? 'dsh-plugin-hello'
const TIMEOUT_MS = 240_000

let profileDir: string
let version: string
let integrity: string

beforeAll(async () => {
  profileDir = mkdtempSync(join(tmpdir(), 'harness-install-e2e-'))
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify(
      { name: 'dsh-profile-test', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } },
      undefined,
      2,
    ) + '\n',
  )
  // Resolve the pinned version and its integrity the way ingestion does.
  const packument = (await fetchPackument(PACKAGE)) as {
    'dist-tags'?: { latest?: string }
    versions?: Record<string, { dist?: { integrity?: string } }>
  }
  const latest = packument['dist-tags']?.latest
  if (latest === undefined) throw new Error(`${PACKAGE} has no latest version`)
  const dist = packument.versions?.[latest]?.dist?.integrity
  if (dist === undefined) throw new Error(`${PACKAGE}@${latest} carries no integrity`)
  version = latest
  integrity = dist
}, 60_000)

afterAll(() => {
  if (profileDir !== undefined) rmSync(profileDir, { recursive: true, force: true })
})

describe('gated install against the live registry', () => {
  it('refuses an artifact that does not match the catalog record', async () => {
    const result = await installPlugin(APP_ROOT, profileDir, PACKAGE, version, {
      integrity: 'sha512-thisisnotthepublishedartifacthash==',
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('integrity_mismatch')
    // Nothing may be written before verification passes.
    expect(installedPlugins(profileDir)).toEqual({})
    expect(readJournal(profileDir)).toBeUndefined()
  }, 60_000)

  it('refuses an unpinned version', async () => {
    const result = await installPlugin(APP_ROOT, profileDir, PACKAGE, null, { integrity })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('version_unpinned')
  })

  it('installs, registers and inspects the package', async () => {
    const result = await installPlugin(APP_ROOT, profileDir, PACKAGE, version, { integrity })
    expect(result.code ?? 'ok').toBe('ok')
    expect(result.ok).toBe(true)
    expect(PACKAGE in installedPlugins(profileDir)).toBe(true)
    expect(existsSync(join(profileDir, 'node_modules', ...PACKAGE.split('/'), 'package.json'))).toBe(true)

    expect(result.inspection).toBeDefined()
    expect(result.inspection?.installScripts).toEqual([])

    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dsh?.profile?.bundles).toContain(PACKAGE)
    // A committed install leaves no journal for recovery to act on.
    expect(readJournal(profileDir)).toBeUndefined()
  }, TIMEOUT_MS)

  it('uninstalls back to the starting state', async () => {
    const result = await uninstallPlugin(APP_ROOT, profileDir, PACKAGE)
    expect(result.ok).toBe(true)
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(PACKAGE in (manifest.dependencies ?? {})).toBe(false)
    expect(manifest.dsh?.profile?.bundles ?? []).not.toContain(PACKAGE)
    expect(readJournal(profileDir)).toBeUndefined()
  }, TIMEOUT_MS)
})
