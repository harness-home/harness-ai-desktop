// afterPack hard gate. Two checks, both learned from a real escape:
// 1. required paths exist in the packaged tree;
// 2. the whole runtime module closure (dependencies AND peerDependencies) is
//    present. dsh packages declare their Service Definition siblings as peers
//    and electron-builder walks only `dependencies`, so a missing peer boots
//    fine from dist/ (Node's parent walk finds the dev tree) and fails on a
//    real install. Never trust a smoke test run from inside the repo.
'use strict'
const { existsSync } = require('node:fs')
const { join } = require('node:path')

/** Paths relative to the packaged app root (resources/app) that must exist. */
const REQUIRED = [
  'package.json',
  'out/main/index.js',
  'out/preload/index.cjs',
  'out/renderer/index.html',
  'build/icon.png',
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
  'node_modules/@harness-ai/desktop-account-ui/lib/client.js',
  'node_modules/@harness-ai/desktop-market-ui/lib/client.js',
  'node_modules/@harness-ai/desktop-windows-pwsh-sandbox/lib/trampoline.mjs',
  'node_modules/@harness-ai/desktop-directory-picker/lib/index.js',
  // pnpm powers market plugin installs into the profile.
  'node_modules/pnpm/bin/pnpm.mjs',
  'THIRD_PARTY_NOTICES.md',
]

/** Closure packages that never load in the packaged host (browser-only peers). */
const NOT_REQUIRED_AT_RUNTIME = new Set([
  'react', 'react-dom', 'scheduler', 'loose-envify', 'csstype',
  '@types/react', '@types/prop-types',
])

module.exports = async function verifyPackaged(context) {
  const appRoot = join(context.appOutDir, 'resources', 'app')
  const missing = REQUIRED.filter((path) => !existsSync(join(appRoot, path)))
  if (missing.length > 0) {
    throw new Error(`packaged runtime is incomplete; missing:\n  ${missing.join('\n  ')}`)
  }

  const { runtimeClosure } = await import('./runtime-closure.mjs')
  const closure = runtimeClosure()
  const missingModules = closure.filter((name) =>
    !NOT_REQUIRED_AT_RUNTIME.has(name)
    && !existsSync(join(appRoot, 'node_modules', ...name.split('/'), 'package.json')))
  if (missingModules.length > 0) {
    throw new Error(
      `packaged node_modules is missing ${String(missingModules.length)} runtime-closure package(s) `
      + `(declare them as direct dependencies):\n  ${missingModules.join('\n  ')}`)
  }
  console.log(`verify-packaged: ${String(REQUIRED.length)} required paths, ${String(closure.length)} closure packages present`)
}
