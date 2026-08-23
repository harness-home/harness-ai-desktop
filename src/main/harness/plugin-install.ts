// Profile plugin installation for the market: runs the bundled pnpm inside the
// desktop profile directory, exactly the way `dsh plugin add` does, then lets
// dsh's own reconciliation register any package that exports a bundle patch.
// We never write our own installer or resolver.
//
// Supply-chain posture (workspace ledger #21/#22): only packages the market
// catalog serves can be installed from the UI, the registry is pinned to
// npmjs, and install-time lifecycle scripts stay blocked by pnpm's default
// (the profile's pnpm-workspace.yaml has no allowBuilds entries).
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../log'

const INSTALL_TIMEOUT_MS = 180_000
const REGISTRY = 'https://registry.npmjs.org/'

export interface InstallResult {
  ok: boolean
  /** Machine-readable failure reason for the UI. */
  code?: string
  /** Trimmed pnpm output, useful in the shell log and the error surface. */
  detail?: string
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
function ensureProfileSettings(profileDir: string): void {
  const file = join(profileDir, 'pnpm-workspace.yaml')
  const wanted = `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n`
  if (!existsSync(file)) writeFileSync(file, wanted)
  const npmrc = join(profileDir, '.npmrc')
  // Pin the registry so a machine-level npmrc cannot redirect plugin installs.
  if (!existsSync(npmrc)) writeFileSync(npmrc, `registry=${REGISTRY}\n`)
}

/**
 * Run one pnpm command inside the profile directory using the app's own Node
 * runtime (Electron in run-as-node mode), so no system pnpm or Node install is
 * required on the user's machine.
 */
function runPnpm(appRoot: string, profileDir: string, args: readonly string[]): Promise<InstallResult> {
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
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', npm_config_registry: REGISTRY },
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

/** Install one catalog package into the desktop profile. */
export async function installPlugin(
  appRoot: string,
  profileDir: string,
  packageName: string,
  version: string | null,
): Promise<InstallResult> {
  ensureProfileSettings(profileDir)
  const spec = version === null || version === '' ? packageName : `${packageName}@${version}`
  log.info(`market: installing ${spec} into ${profileDir}`)
  const result = await runPnpm(appRoot, profileDir, ['add', spec, '--registry', REGISTRY])
  if (!result.ok) {
    log.warn(`market: install of ${spec} failed (${result.code ?? 'unknown'})`)
    return result
  }
  reconcileProfileBundles(profileDir)
  return result
}

/** Remove one installed plugin from the desktop profile. */
export async function uninstallPlugin(
  appRoot: string,
  profileDir: string,
  packageName: string,
): Promise<InstallResult> {
  log.info(`market: removing ${packageName} from ${profileDir}`)
  const result = await runPnpm(appRoot, profileDir, ['remove', packageName])
  if (result.ok) reconcileProfileBundles(profileDir)
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
