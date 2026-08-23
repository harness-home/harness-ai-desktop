// Profile plugin safety net.
//
// Plugins the market installs live in the profile directory and are registered
// as profile bundle layers. If one of them cannot be loaded — the package was
// removed behind our back, the install was interrupted, the app was replaced by
// a build that cannot resolve it, the plugin itself throws on import — the
// Loader fails the whole tree and the client becomes a brick that only shows a
// stack trace.
//
// So a profile plugin is never allowed to be load-bearing. Before boot every
// profile-owned bundle is audited; anything that cannot possibly load is
// quarantined (removed from the bundle list, recorded in a sidecar file) and
// the client starts without it. If boot still fails, the caller quarantines the
// rest and retries — the client always comes up, and the market panel tells the
// user which plugins were disabled and why.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../log'

/** Sidecar recording what was disabled, next to the profile manifest. */
const QUARANTINE_FILENAME = 'harness-quarantine.json'

/** Why a bundle was disabled. */
export type QuarantineReason =
  /** The package is not present in the profile's node_modules. */
  | 'package-missing'
  /** Present, but its manifest no longer declares a dsh bundle patch. */
  | 'not-a-plugin'
  /** The bundle patch file the manifest points at does not exist. */
  | 'patch-missing'
  /** The package manifest could not be read or parsed. */
  | 'manifest-unreadable'
  /** It loaded far enough to break the runtime; disabled after a failed boot. */
  | 'boot-failed'

export interface QuarantineEntry {
  /** Package name as it appears in the profile bundle list. */
  name: string
  reason: QuarantineReason
  /** ISO timestamp of the quarantine decision. */
  at: string
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

function manifestPath(profileDir: string): string {
  return join(profileDir, 'package.json')
}

function readManifest(profileDir: string): ProfileManifest | undefined {
  try {
    return JSON.parse(readFileSync(manifestPath(profileDir), 'utf8')) as ProfileManifest
  } catch {
    return undefined
  }
}

function writeManifest(profileDir: string, manifest: ProfileManifest): void {
  writeFileSync(manifestPath(profileDir), JSON.stringify(manifest, undefined, 2) + '\n')
}

/**
 * Bundles the profile owns, i.e. everything the installation does not provide
 * itself. Template bundles (`@deepseek-ai/dsh-*`) ship inside the app and are
 * never quarantined — if one of those is broken the installation is broken.
 */
export function profileOwnedBundles(profileDir: string): string[] {
  const manifest = readManifest(profileDir)
  return (manifest?.dsh?.profile?.bundles ?? []).filter((name) => !name.startsWith('@deepseek-ai/dsh-'))
}

/** Why this bundle cannot load, or undefined when it looks loadable. */
export function inspectBundle(profileDir: string, name: string): QuarantineReason | undefined {
  const packageDir = join(profileDir, 'node_modules', ...name.split('/'))
  const packageManifest = join(packageDir, 'package.json')
  if (!existsSync(packageManifest)) return 'package-missing'
  let parsed: { dsh?: { bundle?: { patch?: string } } }
  try {
    parsed = JSON.parse(readFileSync(packageManifest, 'utf8')) as typeof parsed
  } catch {
    return 'manifest-unreadable'
  }
  const patch = parsed.dsh?.bundle?.patch
  if (typeof patch !== 'string') return 'not-a-plugin'
  if (!existsSync(join(packageDir, patch))) return 'patch-missing'
  return undefined
}

export function readQuarantine(profileDir: string): QuarantineEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(join(profileDir, QUARANTINE_FILENAME), 'utf8')) as {
      entries?: QuarantineEntry[]
    }
    return parsed.entries ?? []
  } catch {
    return []
  }
}

function writeQuarantine(profileDir: string, entries: QuarantineEntry[]): void {
  if (entries.length === 0) {
    rmSync(join(profileDir, QUARANTINE_FILENAME), { force: true })
    return
  }
  writeFileSync(
    join(profileDir, QUARANTINE_FILENAME),
    JSON.stringify({ entries }, undefined, 2) + '\n',
  )
}

/**
 * Disable the named bundles: drop them from the profile bundle list and record
 * why. The dependency entry itself is left alone so the user can still see the
 * plugin in the market panel and reinstall or remove it deliberately.
 *
 * @returns the names that were actually disabled by this call.
 */
export function quarantineBundles(
  profileDir: string,
  names: readonly string[],
  reason: QuarantineReason,
  now: () => Date = () => new Date(),
): string[] {
  const manifest = readManifest(profileDir)
  if (manifest === undefined) return []
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const removed = names.filter((name) => bundles.includes(name))
  if (removed.length === 0) return []

  manifest.dsh = {
    ...manifest.dsh,
    profile: { ...manifest.dsh?.profile, bundles: bundles.filter((name) => !removed.includes(name)) },
  }
  writeManifest(profileDir, manifest)

  const at = now().toISOString()
  const existing = readQuarantine(profileDir).filter((entry) => !removed.includes(entry.name))
  writeQuarantine(profileDir, [...existing, ...removed.map((name) => ({ name, reason, at }))])
  return removed
}

/**
 * Drop the record for a plugin without restoring it — used after the plugin is
 * uninstalled, so a removed plugin stops being reported as disabled.
 */
export function forgetQuarantine(profileDir: string, name: string): void {
  writeQuarantine(profileDir, readQuarantine(profileDir).filter((entry) => entry.name !== name))
}

/**
 * Re-enable a quarantined plugin: put it back in the bundle list and clear its
 * record, but only once it actually looks loadable again. A failed attempt must
 * keep the record — dropping it would leave the plugin disabled with nothing on
 * screen saying so.
 *
 * @returns true when the plugin was restored to the bundle list.
 */
export function releaseQuarantine(profileDir: string, name: string): boolean {
  if (inspectBundle(profileDir, name) !== undefined) return false
  const manifest = readManifest(profileDir)
  if (manifest === undefined) return false
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (!bundles.includes(name)) {
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles, name] } }
    writeManifest(profileDir, manifest)
  }
  forgetQuarantine(profileDir, name)
  return true
}

/**
 * Audit every profile-owned bundle and quarantine the ones that cannot load.
 * Runs before the profile is read for boot.
 *
 * @returns the entries disabled by this audit (empty on a healthy profile).
 */
export function auditProfileBundles(profileDir: string): QuarantineEntry[] {
  const disabled: QuarantineEntry[] = []
  for (const name of profileOwnedBundles(profileDir)) {
    const reason = inspectBundle(profileDir, name)
    if (reason === undefined) continue
    if (quarantineBundles(profileDir, [name], reason).length === 0) continue
    log.warn(`profile: disabled plugin ${name} (${reason})`)
    disabled.push({ name, reason, at: new Date().toISOString() })
  }
  return disabled
}
