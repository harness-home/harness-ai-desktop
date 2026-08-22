// afterPack hard gate: the packaged tree must contain every runtime-critical
// file, or the build fails here instead of on the user's machine.
'use strict'
const { existsSync } = require('node:fs')
const { join } = require('node:path')

/** Paths relative to the packaged app root (resources/app) that must exist. */
const REQUIRED = [
  'package.json',
  'out/main/index.js',
  'out/preload/index.cjs',
  'out/renderer/index.html',
  'node_modules/@deepseek-ai/dsh-app-boot/package.json',
  'node_modules/@deepseek-ai/dsh-base/cordis.patch.yml',
  'node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml',
  'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
  // node-pty loads from prebuilds/ in the packaged tree (build/ is a dev-only
  // postinstall copy that electron-builder rightly leaves out).
  'node_modules/node-pty/prebuilds/win32-x64/conpty.node',
  'node_modules/node-pty/prebuilds/win32-x64/conpty/conpty.dll',
  'node_modules/koffi/package.json',
  'node_modules/@harness-ai/desktop-brand/lib/index.js',
  'node_modules/@harness-ai/desktop-brand/lib/client.js',
  'THIRD_PARTY_NOTICES.md',
]

module.exports = async function verifyPackaged(context) {
  const appRoot = join(context.appOutDir, 'resources', 'app')
  const missing = REQUIRED.filter((path) => !existsSync(join(appRoot, path)))
  if (missing.length > 0) {
    throw new Error(`packaged runtime is incomplete; missing:\n  ${missing.join('\n  ')}`)
  }
  console.log(`verify-packaged: ${String(REQUIRED.length)} required paths present`)
}
