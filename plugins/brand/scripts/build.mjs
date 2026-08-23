// Build both halves of the plugin: the node host row (esm) and the browser
// client bundle in dsh's lazy-CJS format — a CJS body wrapped in a
// window.__ModuleLoader__.load factory whose require() is answered by the
// shell's module table (react and friends stay external).
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const pkg = require(join(root, 'package.json'))

await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(root, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2023',
})

await build({
  entryPoints: [join(root, 'src/client/index.ts')],
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2023',
  sourcemap: true,
  // TSX with the automatic runtime: react/jsx-runtime is a module-table row.
  jsx: 'automatic',
  // Shared browser modules dsh seeds into its client module table: never
  // inline these — a duplicate react-dom breaks portal unmounting.
  external: [
    'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
  ],
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})

console.log(`${pkg.name}: built lib/index.js and lib/client.js`)
