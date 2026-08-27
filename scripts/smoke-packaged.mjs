// Packaged smoke that cannot go falsely green: the packaged app tree is copied
// to a temp directory OUTSIDE the repository first, so Node's parent-directory
// walk can never reach the dev node_modules. A missing runtime dependency
// then fails here instead of on the user's machine after install.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const unpacked = process.argv[2] ?? join(root, 'dist', 'win-unpacked')
const exeName = 'Harness AI.exe'
if (!existsSync(join(unpacked, exeName))) {
  console.error(`smoke-packaged: no packaged app at ${unpacked}; run pnpm run dist:win first`)
  process.exit(1)
}

const stage = join(tmpdir(), 'harness-packaged-smoke')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
console.log(`smoke-packaged: staging a copy outside the repo at ${stage}`)
cpSync(unpacked, stage, { recursive: true })

const child = spawn(join(stage, exeName), [], { stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', (chunk) => { output += String(chunk) })
child.stderr.on('data', (chunk) => { output += String(chunk) })

const PORTS = Array.from({ length: 20 }, (_, i) => 43110 + i)
const deadline = Date.now() + 90_000
let endpoint

while (Date.now() < deadline && endpoint === undefined) {
  for (const port of PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${String(port)}/`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) { endpoint = { port, body: await res.text() }; break }
    } catch { /* not serving yet */ }
  }
  if (endpoint === undefined) await new Promise((r) => setTimeout(r, 1000))
}

const failures = []
if (endpoint === undefined) failures.push('no loopback endpoint appeared within 90s')
else {
  console.log(`smoke-packaged: endpoint up at http://127.0.0.1:${String(endpoint.port)}/`)
  if (!endpoint.body.includes('__DSH_BOOT__') && !endpoint.body.includes('DeepSeek')) {
    failures.push('served page does not look like the dsh web shell')
  }
  for (const plugin of ['harness-brand', 'desktop-account-ui', 'desktop-market-ui']) {
    if (!endpoint.body.includes(plugin)) failures.push(`${plugin} missing from the boot graph`)
    const bundle = await fetch(`http://127.0.0.1:${String(endpoint.port)}/plugins/@harness-ai/${plugin}/client.js`)
    if (!bundle.ok) failures.push(`${plugin} bundle fetch returned ${String(bundle.status)}`)
  }
}

child.kill()
await new Promise((resolve) => child.once('exit', resolve))
// Electron leaves helper processes holding files for a moment; staging cleanup
// is best effort and must never turn a passing smoke into a failure.
await new Promise((resolve) => setTimeout(resolve, 2000))
try {
  rmSync(stage, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
} catch {
  console.warn(`smoke-packaged: could not remove ${stage} yet (helper processes still exiting)`)
}

if (failures.length > 0) {
  console.error(`smoke-packaged FAILED:\n  ${failures.join('\n  ')}`)
  console.error(`--- app output (tail) ---\n${output.slice(-2000)}`)
  process.exit(1)
}
console.log('smoke-packaged passed: endpoint, web shell, and all three plugins verified from an isolated copy')
