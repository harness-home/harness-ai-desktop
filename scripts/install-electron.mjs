// electron >= 43 ships no postinstall of its own; the binary must be fetched
// explicitly via its install.js. @electron/get only honors the ELECTRON_MIRROR
// env var (npmrc mirror keys are ignored), so default it here before running.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

process.env.ELECTRON_MIRROR ??= 'https://npmmirror.com/mirrors/electron/'

const installer = require.resolve('electron/install.js')
const result = spawnSync(process.execPath, [installer], { stdio: 'inherit' })
process.exit(result.status ?? 1)
