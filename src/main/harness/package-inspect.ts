import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Post-install inspection of what a plugin package actually ships.
//
// This is not a sandbox and does not pretend to be one. The runtime's plugin
// permission model governs agent behaviour, not plugin code — an installed
// plugin runs with the whole process (upstream says so explicitly), so no
// scanner here can contain it. What this can do is answer "what does this
// package reach for?" from the shipped source, so a person deciding whether to
// keep it is deciding with the evidence in front of them.
//
// Treat every result as an observation. A plugin that spawns processes is doing
// what a shell-tool plugin is for; the same finding in a theme is a question
// worth asking.

/** Capabilities worth surfacing, in the order they are reported. */
export type PackageCapability =
  | 'process-spawn'
  | 'network'
  | 'filesystem-write'
  | 'dynamic-code'
  | 'native-module'
  | 'environment'

export interface PackageInspection {
  /** Lifecycle hooks that would run at install time; we never run them. */
  installScripts: string[]
  capabilities: PackageCapability[]
  /** Files read; a truncated scan is reported rather than passed off as complete. */
  filesScanned: number
  truncated: boolean
}

/** Hooks npm/pnpm execute when installing a published tarball. */
const INSTALL_SCRIPT_HOOKS = ['preinstall', 'install', 'postinstall'] as const

/** Bounds so one pathological package cannot stall the install path. */
const MAX_FILES = 400
const MAX_FILE_BYTES = 512 * 1024
const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'tests', '__tests__', 'fixtures'])
const CODE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']

const CAPABILITY_PATTERNS: [PackageCapability, RegExp][] = [
  ['process-spawn', /\b(child_process|execSync|spawnSync|node:child_process)\b/],
  ['network', /\b(fetch\s*\(|node:https?|require\(['"]https?['"]\)|WebSocket|net\.connect)/],
  ['filesystem-write', /\b(writeFileSync|writeFile|rmSync|unlinkSync|node:fs\/promises)\b/],
  ['dynamic-code', /\b(eval\s*\(|new Function\s*\(|vm\.runIn)/],
  ['native-module', /\b(process\.dlopen|node-gyp-build|bindings\s*\(|\.node['"])/],
  ['environment', /\bprocess\.env\b/],
]

function codeFiles(root: string): { files: string[]; truncated: boolean } {
  const files: string[] = []
  const stack = [root]
  let truncated = false
  while (stack.length > 0) {
    const dir = stack.pop()
    if (dir === undefined) break
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true
        return { files, truncated }
      }
      const full = join(dir, name)
      let info
      try {
        info = statSync(full)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith('.')) stack.push(full)
      } else if (CODE_EXTENSIONS.some((extension) => name.endsWith(extension))) {
        if (info.size <= MAX_FILE_BYTES) files.push(full)
        else truncated = true
      }
    }
  }
  return { files, truncated }
}

/**
 * Inspect an installed package directory.
 *
 * @param packageDir - the package root inside the profile's node_modules.
 * @returns what the package declares and what its shipped code reaches for.
 */
export function inspectPackage(packageDir: string): PackageInspection {
  const empty: PackageInspection = {
    installScripts: [],
    capabilities: [],
    filesScanned: 0,
    truncated: false,
  }
  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) return empty

  let scripts: Record<string, unknown> = {}
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { scripts?: Record<string, unknown> }
    scripts = manifest.scripts ?? {}
  } catch {
    return empty
  }
  const installScripts = INSTALL_SCRIPT_HOOKS.filter((hook) => typeof scripts[hook] === 'string')

  const { files, truncated } = codeFiles(packageDir)
  const found = new Set<PackageCapability>()
  for (const file of files) {
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const [capability, pattern] of CAPABILITY_PATTERNS) {
      if (!found.has(capability) && pattern.test(source)) found.add(capability)
    }
    if (found.size === CAPABILITY_PATTERNS.length) break
  }

  return {
    installScripts,
    capabilities: CAPABILITY_PATTERNS.map(([capability]) => capability).filter((c) => found.has(c)),
    filesScanned: files.length,
    truncated,
  }
}
