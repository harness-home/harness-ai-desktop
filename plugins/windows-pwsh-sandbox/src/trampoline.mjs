// Node-mode trampoline for the upstream Windows ACL runner: strip the
// run-as-node marker so grandchildren launch normally, then hand argv to the
// exact runner this desktop resolved — anything else is a spoofed launch.
import { fileURLToPath, pathToFileURL } from 'node:url'

const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
const RUNNER_FAILURE_EXIT = 127

async function main() {
  const requestedRunner = process.argv[2]
  for (const key of Object.keys(process.env)) {
    if (key.toUpperCase() === RUN_AS_NODE) delete process.env[key]
  }
  const expectedRunner = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner'))
  if (requestedRunner !== expectedRunner) {
    throw new Error('trampoline received an unexpected ACL runner path')
  }
  process.argv = [process.argv[0], expectedRunner, ...process.argv.slice(3)]
  await import(pathToFileURL(expectedRunner).href)
}

void main().catch((cause) => {
  process.stderr.write(`windows-acl-run: desktop trampoline: ${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exitCode = RUNNER_FAILURE_EXIT
})
