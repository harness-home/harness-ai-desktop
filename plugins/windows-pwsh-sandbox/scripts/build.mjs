// Build the node half and copy the trampoline beside it: the trampoline must
// stay a real on-disk script (it is spawned as a child process, never bundled).
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(root, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2023',
  packages: 'external',
})

mkdirSync(join(root, 'lib'), { recursive: true })
copyFileSync(join(root, 'src/trampoline.mjs'), join(root, 'lib/trampoline.mjs'))
console.log('@harness-ai/desktop-windows-pwsh-sandbox: built lib/index.js + trampoline')
