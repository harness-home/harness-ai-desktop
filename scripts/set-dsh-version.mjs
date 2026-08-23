// One-command dsh upgrade: rewrite every `catalog:dsh` version in
// pnpm-workspace.yaml, then let pnpm resolve the new tree.
//
//   node scripts/set-dsh-version.mjs 0.1.2-rc.1   # bump every dsh package
//   node scripts/set-dsh-version.mjs --print      # show the current version
//
// Why a script and not a YAML anchor: pnpm rewrites pnpm-workspace.yaml on
// install (minimumReleaseAgeExclude, allowBuilds prompts) and expands anchors
// into literal values, so the anchor silently stops being the single point of
// truth. This script is that single point instead — it also fails loudly when
// the catalog is not internally consistent.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const workspaceFile = join(root, 'pnpm-workspace.yaml')

/** Match one `    "@deepseek-ai/dsh…": <version>` line inside the dsh catalog. */
const ENTRY = /^(\s+"@deepseek-ai\/dsh(?:-[a-z0-9-]+)?":\s*)(\S+)$/

/** Read the dsh catalog block's lines (between `  dsh:` and the next catalog). */
function catalogLines(content) {
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex((line) => /^\s{2}dsh:\s*$/.test(line))
  if (start < 0) throw new Error('pnpm-workspace.yaml has no `dsh:` catalog block')
  const indices = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === undefined) break
    if (/^\s{0,2}\S/.test(line)) break // next catalog or top-level key
    if (ENTRY.test(line)) indices.push(i)
  }
  if (indices.length === 0) throw new Error('the dsh catalog block declares no packages')
  return { lines, indices }
}

function currentVersions(lines, indices) {
  return new Set(indices.map((index) => ENTRY.exec(lines[index])?.[2]).filter((v) => v !== undefined))
}

const target = process.argv[2]
const content = readFileSync(workspaceFile, 'utf8')
const { lines, indices } = catalogLines(content)
const versions = currentVersions(lines, indices)

if (target === undefined || target === '--print') {
  const list = [...versions].join(', ')
  console.log(`dsh catalog: ${String(indices.length)} packages at ${list}`)
  if (versions.size > 1) {
    console.error('catalog is inconsistent — run this script with a version to realign it')
    process.exit(1)
  }
  process.exit(0)
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(target)) {
  console.error(`not a valid version: ${target}`)
  process.exit(1)
}

for (const index of indices) {
  const line = lines[index]
  if (line === undefined) continue
  lines[index] = line.replace(ENTRY, `$1${target}`)
}
writeFileSync(workspaceFile, lines.join('\n'))
console.log(`dsh catalog: ${String(indices.length)} packages set to ${target} (was ${[...versions].join(', ')})`)
console.log('next: pnpm install && pnpm typecheck && pnpm build && node scripts/smoke-packaged.mjs')
