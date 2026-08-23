// Build both halves in dsh's lazy-CJS client format. The Tailwind CSS
// (compiled to lib/client.css by the build script's first step) is injected
// as one deduplicated style tag at factory execution — the same shape as
// dsh's own client-bundle CSS injection.
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
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

const css = readFileSync(join(root, 'lib/client.css'), 'utf8')
const styleInject = [
  '(function(){',
  `var id=${JSON.stringify(`${pkg.name}/client.css`)};`,
  'if(typeof document!=="undefined"&&document.querySelector(\'style[data-plugin-css="\'+id+\'"]\')===null){',
  'var tag=document.createElement("style");',
  `tag.dataset.plugin=${JSON.stringify(pkg.name)};`,
  'tag.dataset.pluginCss=id;',
  `tag.textContent=${JSON.stringify(css)};`,
  'document.head.appendChild(tag);}',
  '})();',
].join('')

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
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {\n${styleInject}\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})

console.log(`${pkg.name}: built lib/index.js, lib/client.js and injected css`)
