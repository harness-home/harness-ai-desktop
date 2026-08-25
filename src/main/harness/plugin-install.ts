// Profile plugin installation for the market: runs the bundled pnpm inside the
// desktop profile directory, exactly the way `dsh plugin add` does, then lets
// dsh's own reconciliation register any package that exports a bundle patch.
// We never write our own installer or resolver.
//
// Supply-chain posture (workspace ledger #21/#22/#27). The runtime cannot
// contain a plugin — an installed one gets the whole process — so everything
// protective happens before and around the install:
//   1. only packages the market catalog serves can be installed from the UI;
//   2. one registry answers every lookup and every download — the configured
//      one, npmjs unless a deployment changed it (`runtime-config.ts`) —
//      applied in three independent places, so no ambient setting can redirect
//      an install halfway through. Which registry serves the bytes is not what
//      makes them trustworthy; (3) is;
//   3. the pinned version's tarball integrity is re-verified against the
//      catalog's record, so a republished version is refused (`install-guard`);
//   4. install-time lifecycle scripts never run — pnpm's default plus an
//      explicit --ignore-scripts, and a package that needs them is refused
//      rather than half-installed;
//   5. every mutation is journaled and rolled back on failure or crash
//      (`install-journal`), because a profile that names a bundle it cannot
//      load is a client that will not start;
//   6. what the package actually reaches for is reported to the person who
//      installed it (`package-inspect`).
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../log'
import { pluginRegistryForNpm } from '../runtime-config'
import { createPackumentFetcher, verifyIntegrity, type PackumentFetcher } from './install-guard'
import { beginOperation, completeOperation, rollback } from './install-journal'
import { inspectPackage, type PackageInspection } from './package-inspect'

const INSTALL_TIMEOUT_MS = 180_000

export interface InstallResult {
  ok: boolean
  /** Machine-readable failure reason for the UI. */
  code?: string
  /** Trimmed pnpm output, useful in the shell log and the error surface. */
  detail?: string
  /** What the installed package declares and reaches for; present on success. */
  inspection?: PackageInspection
}

/**
 * Absolute path of the bundled pnpm CLI entry. Located by path rather than by
 * module resolution: pnpm's package manifest restricts `exports` so hard that
 * even `pnpm/package.json` cannot be required.
 */
function pnpmCli(appRoot: string): string {
  const packageDir = join(appRoot, 'node_modules', 'pnpm')
  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) throw new Error('the bundled pnpm package is missing')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: string | Record<string, string> }
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pnpm
  if (entry === undefined) throw new Error('the bundled pnpm package declares no bin entry')
  const cli = join(packageDir, entry)
  if (!existsSync(cli)) throw new Error(`the bundled pnpm CLI is missing at ${cli}`)
  return cli
}

/** The profile's installed plugin dependencies (package name → version range). */
export function installedPlugins(profileDir: string): Record<string, string> {
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) return {}
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
    return manifest.dependencies ?? {}
  } catch {
    return {}
  }
}

/** Keep the profile's pnpm settings aligned with the shell's install policy. */
function ensureProfileSettings(profileDir: string, registry: string): void {
  const file = join(profileDir, 'pnpm-workspace.yaml')
  const wanted = `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n`
  if (!existsSync(file)) writeFileSync(file, wanted)
  writeProfileRegistry(join(profileDir, '.npmrc'), registry)
}

/**
 * State the registry in the profile's own npmrc, so a machine-level npmrc
 * cannot redirect plugin installs. Rewritten on every install rather than only
 * created: the configured registry can change on an installed client, and a
 * line left behind by the previous one would quietly outrank it wherever pnpm
 * reads settings instead of the flag.
 */
function writeProfileRegistry(npmrc: string, registry: string): void {
  const wanted = `registry=${registry}`
  if (!existsSync(npmrc)) {
    writeFileSync(npmrc, `${wanted}\n`)
    return
  }
  const lines = readFileSync(npmrc, 'utf8').split(/\r?\n/)
  const at = lines.findIndex(line => /^\s*registry\s*=/.test(line))
  if (at === -1) lines.unshift(wanted)
  else if (lines[at] === wanted) return
  else lines[at] = wanted
  writeFileSync(npmrc, lines.join('\n'))
}

/**
 * Run one pnpm command inside the profile directory using the app's own Node
 * runtime (Electron in run-as-node mode), so no system pnpm or Node install is
 * required on the user's machine.
 */
function runPnpm(
  appRoot: string,
  profileDir: string,
  registry: string,
  args: readonly string[],
): Promise<InstallResult> {
  return new Promise((resolve) => {
    let cli: string
    try {
      cli = pnpmCli(appRoot)
    } catch {
      resolve({ ok: false, code: 'pnpm_missing', detail: 'the bundled pnpm CLI is not present' })
      return
    }
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: profileDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', npm_config_registry: registry },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, code: 'install_timeout', detail: output.slice(-800) })
    }, INSTALL_TIMEOUT_MS)
    child.once('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, code: 'spawn_failed', detail: error.message })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ ok: true })
      else resolve({ ok: false, code: 'pnpm_failed', detail: output.slice(-800) })
    })
  })
}

export interface InstallOptions {
  /** Tarball integrity the catalog recorded for this exact version. */
  integrity: string | null
  /** Registry lookup override, for tests. */
  fetcher?: PackumentFetcher
}

/** Install one catalog package into the desktop profile. */
export async function installPlugin(
  appRoot: string,
  profileDir: string,
  packageName: string,
  version: string | null,
  options: InstallOptions,
): Promise<InstallResult> {
  if (version === null || version === '') {
    // Without a pinned version there is nothing to verify an artifact against,
    // and "latest" would mean installing whatever the registry serves today.
    return { ok: false, code: 'version_unpinned', detail: 'the catalog pins no version for this package' }
  }
  const spec = `${packageName}@${version}`
  const registry = pluginRegistryForNpm()

  // The packument is read from the registry the tarball will come from. That is
  // what lets a deployment point this client at a mirror: a mirror serving
  // different bytes fails the comparison instead of being trusted for them.
  const fetcher = options.fetcher ?? createPackumentFetcher(registry)
  const verdict = await verifyIntegrity(packageName, version, options.integrity, fetcher)
  if (!verdict.ok) {
    log.warn(`market: refusing ${spec} (${verdict.code}): ${verdict.detail}`)
    return { ok: false, code: verdict.code, detail: verdict.detail }
  }

  ensureProfileSettings(profileDir, registry)
  const journaled = beginOperation(profileDir, 'install', packageName, version)
  log.info(`market: installing ${spec} into ${profileDir}`)
  // --ignore-scripts is redundant with the profile having no allowBuilds
  // entries, and stated anyway: this is the one policy that must not depend on
  // a settings file staying the way we wrote it.
  const result = await runPnpm(appRoot, profileDir, registry, ['add', spec, '--registry', registry, '--ignore-scripts'])
  if (!result.ok) {
    log.warn(`market: install of ${spec} failed (${result.code ?? 'unknown'})`)
    if (journaled) rollback(profileDir)
    return result
  }

  const inspection = inspectPackage(join(profileDir, 'node_modules', ...packageName.split('/')))
  if (inspection.installScripts.length > 0) {
    // The scripts were never run, so the package is not in the state it expects
    // to be in. Keeping it would leave something half-installed that looks fine.
    log.warn(`market: ${spec} needs install scripts (${inspection.installScripts.join(', ')}); removing it`)
    await runPnpm(appRoot, profileDir, registry, ['remove', packageName])
    if (journaled) rollback(profileDir)
    else reconcileProfileBundles(profileDir)
    return {
      ok: false,
      code: 'install_scripts_required',
      detail: `this package runs code at install time (${inspection.installScripts.join(', ')}), which is not allowed`,
    }
  }

  reconcileProfileBundles(profileDir)
  if (journaled) completeOperation(profileDir)
  return { ...result, inspection }
}

/** Remove one installed plugin from the desktop profile. */
export async function uninstallPlugin(
  appRoot: string,
  profileDir: string,
  packageName: string,
): Promise<InstallResult> {
  log.info(`market: removing ${packageName} from ${profileDir}`)
  const journaled = beginOperation(profileDir, 'uninstall', packageName, null)
  const result = await runPnpm(appRoot, profileDir, pluginRegistryForNpm(), ['remove', packageName])
  if (!result.ok) {
    if (journaled) rollback(profileDir)
    return result
  }
  reconcileProfileBundles(profileDir)
  if (journaled) completeOperation(profileDir)
  return result
}

/**
 * Register or unregister profile bundle layers after a dependency change —
 * the same reconciliation `dsh plugin` performs after its own pnpm run: a
 * dependency that exports `dsh.bundle.patch` becomes a profile layer, and one
 * that is gone stops being one. Without it an installed plugin sits in
 * node_modules and never loads.
 */
export function reconcileProfileBundles(profileDir: string): { bundles: string[]; changed: boolean } {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  const dependencies = Object.keys(manifest.dependencies ?? {})
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  let changed = false

  const exportsPatch = (packageName: string): boolean => {
    const packageManifest = join(profileDir, 'node_modules', ...packageName.split('/'), 'package.json')
    if (!existsSync(packageManifest)) return false
    try {
      const parsed = JSON.parse(readFileSync(packageManifest, 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
      return typeof parsed.dsh?.bundle?.patch === 'string'
    } catch {
      return false
    }
  }

  for (const packageName of dependencies) {
    if (exportsPatch(packageName) && !bundles.includes(packageName)) {
      bundles.push(packageName)
      changed = true
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...bundles]) {
    // Template bundles (dsh-base and friends) are not dependencies and stay.
    if (!dependencySet.has(packageName) && packageName.startsWith('@deepseek-ai/dsh-') === false) {
      bundles.splice(bundles.indexOf(packageName), 1)
      changed = true
    }
  }
  if (changed) {
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    log.info(`market: profile bundles now ${bundles.join(', ')}`)
  }
  return { bundles, changed }
}
