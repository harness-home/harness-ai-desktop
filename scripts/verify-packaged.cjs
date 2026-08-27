// afterPack hard gate. Two checks, both learned from a real escape:
// 1. required paths exist in the packaged tree;
// 2. the whole runtime module closure (dependencies AND peerDependencies) is
//    present. dsh packages declare their Service Definition siblings as peers
//    and electron-builder walks only `dependencies`, so a missing peer boots
//    fine from dist/ (Node's parent walk finds the dev tree) and fails on a
//    real install. Never trust a smoke test run from inside the repo.
//
// The app root is a directory when asar is off and an archive when it is on,
// so both checks go through `packagedApp()` rather than through `existsSync`.
// That indirection is the whole point of it: with asar on, every path below
// stops existing as a filesystem path, and a gate written against filesystem
// paths would not start failing — it would start passing while checking
// nothing, which is worse than never having had it.
'use strict'
const { existsSync } = require('node:fs')
const { join, sep } = require('node:path')

/** Paths relative to the packaged app root that must exist. */
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
  'node_modules/@harness-ai/harness-brand/lib/index.js',
  'node_modules/@harness-ai/harness-brand/lib/client.js',
  'node_modules/@harness-ai/desktop-account-ui/lib/client.js',
  'node_modules/@harness-ai/desktop-market-ui/lib/client.js',
  'node_modules/@harness-ai/desktop-windows-pwsh-sandbox/lib/trampoline.mjs',
  'node_modules/@harness-ai/desktop-directory-picker/lib/index.js',
  // pnpm powers market plugin installs into the profile.
  'node_modules/pnpm/bin/pnpm.mjs',
  'THIRD_PARTY_NOTICES.md',
]

/**
 * Paths that must be real files on disk rather than archive members, because
 * the thing that opens them is not Node: `process.dlopen` for native addons,
 * and the OS loader for anything spawned as a process. Under asar these have to
 * land in app.asar.unpacked; with asar off the check is trivially satisfied.
 */
const REQUIRED_UNPACKED = [
  'node_modules/node-pty/prebuilds/win32-x64/conpty.node',
  'node_modules/node-pty/prebuilds/win32-x64/conpty/conpty.dll',
  'node_modules/node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe',
  'node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node',
  'node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe',
  'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.3.node',
  'node_modules/@img/sharp-win32-x64/lib/libvips-cpp-8.18.3.dll',
]

/** Closure packages that never load in the packaged host (browser-only peers). */
const NOT_REQUIRED_AT_RUNTIME = new Set([
  'react', 'react-dom', 'scheduler', 'loose-envify', 'csstype',
  '@types/react', '@types/prop-types',
])

/**
 * Ask the packaged app whether it carries a path, whichever shape it has.
 *
 * @param appOutDir - the packaged application directory.
 * @returns `describe` for messages, `has` for "the app carries this", and
 *   `hasOnDisk` for "and it is a real file, not an archive member".
 */
function packagedApp(appOutDir) {
  const resources = join(appOutDir, 'resources')
  const archive = join(resources, 'app.asar')

  if (!existsSync(archive)) {
    const root = join(resources, 'app')
    const at = (path) => join(root, ...path.split('/'))
    return {
      shape: 'directory',
      describe: root,
      has: (path) => existsSync(at(path)),
      hasOnDisk: (path) => existsSync(at(path)),
    }
  }

  // @electron/asar comes with electron-builder; the archive is read through it
  // rather than by unpacking, so the gate stays cheap.
  const { statFile } = require('@electron/asar')
  const unpacked = join(resources, 'app.asar.unpacked')
  // Filesystem.getFile splits on path.sep, so the lookup key is native.
  const key = (path) => path.split('/').join(sep)
  const entry = (path) => {
    try {
      return statFile(archive, key(path), true)
    } catch {
      return undefined
    }
  }
  return {
    shape: 'asar',
    describe: archive,
    has(path) {
      const found = entry(path)
      if (found === undefined) return false
      // The header records an unpacked entry exactly like a packed one, so a
      // wrong asarUnpack glob would pass here and fail at dlopen time.
      if (found.unpacked === true) return existsSync(join(unpacked, ...path.split('/')))
      return true
    },
    hasOnDisk: (path) => existsSync(join(unpacked, ...path.split('/'))),
  }
}

module.exports = async function verifyPackaged(context) {
  const app = packagedApp(context.appOutDir)

  const missing = REQUIRED.filter((path) => !app.has(path))
  if (missing.length > 0) {
    throw new Error(`packaged runtime is incomplete (${app.describe}); missing:\n  ${missing.join('\n  ')}`)
  }

  const packed = REQUIRED_UNPACKED.filter((path) => !app.hasOnDisk(path))
  if (packed.length > 0) {
    throw new Error(
      'these must be real files on disk — they are opened by dlopen or by the OS, not by Node — '
      + `but they are not:\n  ${packed.join('\n  ')}`)
  }

  // Beside the executable rather than inside the app: this is the file a person
  // edits on an installed machine (src/main/runtime-config.ts). Shipping a build
  // without it would leave nothing to edit and no sign that there should have been.
  if (!existsSync(join(context.appOutDir, 'harness-ai.config.json'))) {
    throw new Error('packaged app is missing harness-ai.config.json beside the executable')
  }

  const { runtimeClosure } = await import('./runtime-closure.mjs')
  const closure = runtimeClosure()
  const missingModules = closure.filter((name) =>
    !NOT_REQUIRED_AT_RUNTIME.has(name)
    && !app.has(`node_modules/${name}/package.json`))
  if (missingModules.length > 0) {
    throw new Error(
      `packaged node_modules is missing ${String(missingModules.length)} runtime-closure package(s) `
      + `(declare them as direct dependencies):\n  ${missingModules.join('\n  ')}`)
  }
  console.log(
    `verify-packaged (${app.shape}): ${String(REQUIRED.length)} required paths, `
    + `${String(REQUIRED_UNPACKED.length)} unpacked, ${String(closure.length)} closure packages present`)
}
