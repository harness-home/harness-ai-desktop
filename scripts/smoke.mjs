// Automated startup smoke: launch the built shell, wait for the loopback web
// endpoint, assert the page and the brand plugin are served, then shut down.
// Usage: node scripts/smoke.mjs [path-to-electron-executable]
// Default runs the dev tree via the local electron binary; pass the packaged
// "Harness AI.exe" to smoke an installed build.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const PORT_RANGE = Array.from({ length: 20 }, (_, i) => 43110 + i)
const STARTUP_TIMEOUT_MS = 90_000

const target = process.argv[2]
const command = target ?? join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const args = target === undefined ? [root] : []
if (!existsSync(command)) {
  console.error(`smoke: executable not found: ${command}`)
  process.exit(1)
}

const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', (chunk) => { output += String(chunk) })
child.stderr.on('data', (chunk) => { output += String(chunk) })

async function findEndpoint() {
  for (const port of PORT_RANGE) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/`, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return { port, body: await response.text() }
    } catch {
      // Port not serving; try the next.
    }
  }
  return undefined
}

const deadline = Date.now() + STARTUP_TIMEOUT_MS
let endpoint
while (Date.now() < deadline && endpoint === undefined) {
  endpoint = await findEndpoint()
  if (endpoint === undefined) await new Promise((resolve) => setTimeout(resolve, 1000))
}

const failures = []
if (endpoint === undefined) {
  failures.push(`no loopback endpoint appeared within ${String(STARTUP_TIMEOUT_MS / 1000)}s`)
} else {
  console.log(`smoke: endpoint up at http://127.0.0.1:${String(endpoint.port)}/`)
  if (!endpoint.body.includes('__DSH_BOOT__') && !endpoint.body.includes('DeepSeek')) {
    failures.push('served page does not look like the dsh web shell')
  }
  if (!endpoint.body.includes('desktop-brand')) {
    failures.push('brand plugin is missing from the boot graph')
  }
  const bundle = await fetch(`http://127.0.0.1:${String(endpoint.port)}/plugins/@harness-ai/desktop-brand/client.js`)
  if (!bundle.ok) failures.push(`brand client bundle fetch returned ${String(bundle.status)}`)
}

child.kill()
await new Promise((resolve) => child.once('exit', resolve))

if (failures.length > 0) {
  console.error(`smoke FAILED:\n  ${failures.join('\n  ')}`)
  console.error(`--- app output (tail) ---\n${output.slice(-2000)}`)
  process.exit(1)
}
console.log('smoke passed: endpoint, web shell, and brand plugin all verified')
