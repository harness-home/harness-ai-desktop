// License whitelist gate + THIRD_PARTY_NOTICES.md generator. Walks the
// production dependency closure from package.json over the hoisted
// node_modules; a dependency whose license is not on the allowlist fails the
// build so a distribution problem surfaces before packaging.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const ALLOWED = new Set([
  'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD',
  'BlueOak-1.0.0', 'CC0-1.0', 'CC-BY-4.0', 'Unlicense', 'Python-2.0', 'MPL-2.0',
  'LGPL-3.0-or-later',
])

/** Compound SPDX expressions and license-less packages reviewed by hand. */
const OVERRIDES = new Map([
  // node-pty prebuilds carry the repository license in the package tarball.
])

function packageDir(name) {
  const dir = join(root, 'node_modules', ...name.split('/'))
  return existsSync(join(dir, 'package.json')) ? dir : undefined
}

function licenseOf(manifest) {
  if (typeof manifest.license === 'string') return manifest.license
  if (typeof manifest.license === 'object' && manifest.license !== null) return manifest.license.type
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((l) => l.type).join(' OR ')
  return undefined
}

function expressionAllowed(expression) {
  if (expression === undefined) return false
  if (ALLOWED.has(expression)) return true
  // Accept a compound expression when every referenced id is allowed, or any
  // one is for an OR choice.
  const ids = expression.replace(/[()]/g, ' ').split(/\s+(?:AND|OR|WITH)\s+|\s+/).filter(Boolean)
  return ids.length > 1 && ids.every((id) => ALLOWED.has(id))
}

const seen = new Map()
const queue = Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies ?? {})
const missing = []
const rejected = []

while (queue.length > 0) {
  const name = queue.shift()
  if (seen.has(name)) continue
  // First-party workspace packages are not third-party notices material.
  if (name.startsWith('@harness-ai/')) {
    seen.set(name, undefined)
    continue
  }
  const dir = packageDir(name)
  if (dir === undefined) {
    // Optional dependency not installed on this platform.
    seen.set(name, undefined)
    continue
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const license = OVERRIDES.get(name) ?? licenseOf(manifest)
  seen.set(name, { version: manifest.version, license })
  if (license === undefined) missing.push(name)
  else if (!expressionAllowed(license)) rejected.push(`${name}@${manifest.version}: ${license}`)
  for (const dep of [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]) {
    if (!seen.has(dep)) queue.push(dep)
  }
}

if (missing.length > 0 || rejected.length > 0) {
  if (missing.length > 0) console.error(`license gate: no license declared by: ${missing.join(', ')}`)
  if (rejected.length > 0) console.error(`license gate: outside the allowlist:\n  ${rejected.join('\n  ')}`)
  process.exit(1)
}

const rows = [...seen.entries()]
  .filter(([, info]) => info !== undefined)
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([name, info]) => `- ${name}@${info.version} — ${info.license}`)

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), `# Third-Party Notices

Harness AI Desktop bundles the following third-party packages. Each package is
distributed under its own license, listed below; full license texts ship inside
the respective package directories under \`resources/app/node_modules\`.

${rows.join('\n')}
`)

console.log(`gen-notices: ${String(rows.length)} packages, all licenses on the allowlist`)
