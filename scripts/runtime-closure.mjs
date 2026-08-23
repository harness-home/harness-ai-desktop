// Compute the runtime module closure of the app: BFS over dependencies AND
// peerDependencies from this package.json across the installed node_modules.
// dsh packages declare their Service Definition siblings as peers, and
// electron-builder only walks `dependencies` — so without listing the closure
// explicitly the packaged tree is missing modules that only resolve in the dev
// tree through Node's parent-directory walk.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function manifestOf(name) {
  const path = join(root, 'node_modules', ...name.split('/'), 'package.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
}

export function runtimeClosure() {
  const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const seen = new Set()
  const queue = Object.keys(app.dependencies ?? {})
  while (queue.length > 0) {
    const name = queue.shift()
    if (seen.has(name)) continue
    const manifest = manifestOf(name)
    if (manifest === undefined) continue
    seen.add(name)
    for (const dep of [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]) {
      if (!seen.has(dep)) queue.push(dep)
    }
  }
  return [...seen].sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const closure = runtimeClosure()
  const declared = new Set(Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies ?? {}))
  const missing = closure.filter((name) => !declared.has(name))
  console.log(`closure: ${closure.length} packages, ${missing.length} not declared as direct dependencies`)
  for (const name of missing) console.log(name)
}
