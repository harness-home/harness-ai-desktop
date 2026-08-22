// dsh-backed HarnessAdapter: boots the dsh Host in this process (no child
// process) against a desktop profile composed from the official bundle layers,
// mirroring the upstream `dsh --profile web` launcher. The runtime binds
// loopback only (workspace red line #4).

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  initProfile,
  loadLayeredEnv,
  loadOptionalPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  resolveProfileDir,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { HarnessAdapter, HarnessHandle } from './adapter'
import { findFreePort } from './port'

const BIN_NAME = 'harness-ai-desktop'

/** Our own profile name: shares the dsh home (sessions, credentials) but not the CLI's `web` profile config. */
const PROFILE_NAME = 'desktop'

const PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

const PROFILE_ROOT_FILENAME = 'cordis.yml'

// Same contract as the upstream launcher: the whole composition is patch
// layers over an empty root, and the root is rewritten every boot so the
// Loader's tree write-back can never bake composed rows into it.
const PROFILE_ROOT_CONFIG = `# dsh profile root - an empty entry list managed by Harness AI Desktop.
# The tree is composed as bundle patches plus cordis.patch.yml; edit
# cordis.patch.yml, not this file.
[]
`

// App-owned overlay rows for the desktop's own plugins (resolved from this
// app's node_modules).
const APP_ROWS = [
  {
    insert: [
      { id: 'harness-ai-brand', name: '@harness-ai/desktop-brand' },
    ],
  },
]

/**
 * Mirror the upstream launcher's shipped agent-preset injection: the roster
 * directory ships inside the `@deepseek-ai/dsh` package, and only the app can
 * resolve it. Preserves the composed row's other config values.
 */
function agentPresetOverlay(
  installAnchor: string,
  layers: Parameters<typeof composeEntries>[0],
): object[] {
  const rows = new Map(
    composeEntries(layers)
      .filter(row => typeof row.id === 'string')
      .map(row => [row.id as string, row]),
  )
  const row = rows.get('agent-presets')
  if (row === undefined) return []
  const cliDir = dirname(createRequire(installAnchor).resolve('@deepseek-ai/dsh/package.json'))
  return [{
    id: 'agent-presets',
    config: {
      ...(row.config ?? {}) as Record<string, unknown>,
      roots: [{ path: join(cliDir, 'config', 'agent-presets') + sep, trust: 'system' }],
    },
  }]
}

export interface DshAdapterOptions {
  /** Application root whose package.json anchors bundle resolution (its node_modules holds the runtime). */
  appRoot: string
  /** Called when a plugin requests bounded process exit through the cmdline service. */
  onExitRequest: (code: number) => void
}

export function createDshAdapter(options: DshAdapterOptions): HarnessAdapter {
  let ctx: Context | undefined
  let stopped = false

  return {
    async start(): Promise<HarnessHandle> {
      const installAnchor = join(options.appRoot, 'package.json')
      const home = resolveDshHome()
      // Only the home .env layer applies: a desktop launch has no meaningful
      // invoking directory, unlike the CLI.
      const environment = loadLayeredEnv(BIN_NAME, home)
      healProfilesModuleFallback(installAnchor, home)
      initProfile(resolveProfileDir(PROFILE_NAME, home), PROFILE_BUNDLES)
      const profile = loadProfile(BIN_NAME, PROFILE_NAME, installAnchor, home)
      const rootConfig = join(profile.dir, PROFILE_ROOT_FILENAME)
      writeFileSync(rootConfig, PROFILE_ROOT_CONFIG)
      const homePatches = loadOptionalPatches(BIN_NAME, join(home, PROFILE_PATCH_FILENAME)) ?? []
      const bundlePatches = profile.layers.flatMap(layer => layer.patches)
      // Bundle layers in manifest order, then the profile's user layer, then
      // the home-level user layer — the upstream launcher's application order —
      // then the app-owned overlays (our plugin rows + shipped agent presets).
      const patches = structuredClone([
        ...bundlePatches,
        ...profile.patches,
        ...homePatches,
        ...APP_ROWS,
        ...agentPresetOverlay(installAnchor, [bundlePatches, profile.patches, homePatches]),
      ])
      const port = await findFreePort()
      ctx = await boot(
        BIN_NAME,
        rootConfig,
        patches,
        (hostCtx) => {
          hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
          provideCmdline(hostCtx, {
            // The shell embeds the UI itself: never open the system browser.
            args: ['--no-open', '--host', '127.0.0.1', '--port', String(port)],
            exit: options.onExitRequest,
          })
        },
        pathToFileURL(options.appRoot).href + '/',
      )
      if (stopped) {
        await ctx.fiber.dispose()
        throw new Error(`${BIN_NAME}: harness runtime was stopped during startup`)
      }
      const webServer = ctx.get('webServer')
      if (webServer === undefined) {
        throw new Error(`${BIN_NAME}: harness runtime settled without a web server`)
      }
      return { baseUrl: `http://127.0.0.1:${String(webServer.port)}`, port: webServer.port }
    },

    async stop(): Promise<void> {
      stopped = true
      const current = ctx
      ctx = undefined
      if (current !== undefined) await current.fiber.dispose()
    },
  }
}
