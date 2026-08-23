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
import type { DesktopAccountService } from '../account/service'
import { log } from '../log'
import { installProfileFallbackResolver } from './module-resolution'
import { auditProfileBundles, profileOwnedBundles, quarantineBundles } from './profile-plugins'
import { registerAccountRoutes } from './account-routes'
import { registerChromeCss } from './chrome-css'
import { registerMarketRoutes } from './market-routes'
import { registerUpdateRoutes } from './update-routes'
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
      { id: 'harness-ai-account-ui', name: '@harness-ai/desktop-account-ui' },
      { id: 'harness-ai-market-ui', name: '@harness-ai/desktop-market-ui' },
    ],
  },
]

/**
 * App-owned overlays derived from the composed tree:
 * 1. Shipped agent presets — the roster ships inside the `@deepseek-ai/dsh`
 *    package and only the app can resolve it (mirrors the upstream launcher).
 * 2. Windows pwsh sandbox swap — the upstream ACL sandbox launches its runner
 *    as `process.execPath <runner.js>`, which inside Electron starts a second
 *    app instance; our adapter row trampolines that launch (see
 *    plugins/windows-pwsh-sandbox).
 */
function composedOverlays(
  installAnchor: string,
  layers: Parameters<typeof composeEntries>[0],
): object[] {
  const rows = new Map(
    composeEntries(layers)
      .filter(row => typeof row.id === 'string')
      .map(row => [row.id as string, row]),
  )
  const overlays: object[] = []
  const presets = rows.get('agent-presets')
  if (presets !== undefined) {
    const cliDir = dirname(createRequire(installAnchor).resolve('@deepseek-ai/dsh/package.json'))
    overlays.push({
      id: 'agent-presets',
      config: {
        ...(presets.config ?? {}) as Record<string, unknown>,
        roots: [{ path: join(cliDir, 'config', 'agent-presets') + sep, trust: 'system' }],
      },
    })
  }
  // The upstream native picker spawns a parentless helper that never surfaces
  // inside the shell; swap in the Electron-dialog backend.
  const picker = rows.get('directory-picker')
  if (picker !== undefined) {
    overlays.push(
      { id: 'directory-picker', name: picker.name as string, disabled: true },
      { insert: [{ id: 'desktop-directory-picker', name: '@harness-ai/desktop-directory-picker' }] },
    )
  }
  const pwshSandbox = rows.get('pwsh-sandbox')
  if (process.platform === 'win32' && pwshSandbox?.name === '@deepseek-ai/dsh-pwsh-sandbox') {
    overlays.push(
      { id: 'pwsh-sandbox', name: '@deepseek-ai/dsh-pwsh-sandbox', disabled: true },
      {
        insert: [{
          id: 'desktop-windows-pwsh-sandbox',
          name: '@harness-ai/desktop-windows-pwsh-sandbox',
          ...(pwshSandbox.config === undefined ? {} : { config: pwshSandbox.config }),
        }],
      },
    )
  }
  return overlays
}

export interface DshAdapterOptions {
  /** Application root whose package.json anchors bundle resolution (its node_modules holds the runtime). */
  appRoot: string
  /** Called when a plugin requests bounded process exit through the cmdline service. */
  onExitRequest: (code: number) => void
  /** When present, the account bridge routes are mounted on the web server. */
  accountService?: DesktopAccountService
  /** Restart the shell (used after a market install changes the profile). */
  requestRestart: () => void
}

export function createDshAdapter(options: DshAdapterOptions): HarnessAdapter {
  let ctx: Context | undefined
  let stopped = false
  let releaseResolver: (() => void) | undefined

  return {
    async start(): Promise<HarnessHandle> {
      const installAnchor = join(options.appRoot, 'package.json')
      const home = resolveDshHome()
      // Only the home .env layer applies: a desktop launch has no meaningful
      // invoking directory, unlike the CLI.
      const environment = loadLayeredEnv(BIN_NAME, home)
      healProfilesModuleFallback(installAnchor, home)
      const profileDir = resolveProfileDir(PROFILE_NAME, home)
      initProfile(profileDir, PROFILE_BUNDLES)
      // A market-installed plugin must never be load-bearing: anything that
      // cannot possibly load is disabled before the Loader sees it.
      auditProfileBundles(profileDir)

      const attempt = async (): Promise<HarnessHandle> => {
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
          ...composedOverlays(installAnchor, [bundlePatches, profile.patches, homePatches]),
        ])
        // Must be installed before boot: the Loader resolves every plugin row
        // during the tree mount.
        releaseResolver?.()
        releaseResolver = installProfileFallbackResolver(profile.dir)
        const port = await findFreePort()
        ctx = await boot(
          BIN_NAME,
          rootConfig,
          patches,
          (hostCtx) => {
            hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
            registerChromeCss(hostCtx)
            registerUpdateRoutes(hostCtx)
            if (options.accountService !== undefined) {
              registerAccountRoutes(hostCtx, options.accountService)
              registerMarketRoutes(hostCtx, {
                account: options.accountService,
                appRoot: options.appRoot,
                profileDir: profile.dir,
                requestRestart: options.requestRestart,
              })
            }
            provideCmdline(hostCtx, {
              // The shell embeds the UI itself: never open the system browser.
              args: ['--no-open', '--host', '127.0.0.1', '--port', String(port)],
              exit: options.onExitRequest,
            })
          },
          // In-box packages resolve from the installation (deterministic, and a
          // profile copy must never shadow the runtime); market-installed
          // plugins are picked up by the profile fallback resolver above.
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
      }

      try {
        return await attempt()
      } catch (error) {
        // Second line of defence: a profile plugin that passes the audit can
        // still break the tree at import time. Rather than leave the user with
        // a dead client, disable every profile-installed plugin and come up
        // without them; the market panel reports what was disabled.
        if (stopped) throw error
        const suspects = profileOwnedBundles(profileDir)
        if (suspects.length === 0) throw error
        log.warn(`harness: boot failed with profile plugins active (${suspects.join(', ')}); retrying without them`)
        quarantineBundles(profileDir, suspects, 'boot-failed')
        releaseResolver?.()
        releaseResolver = undefined
        return await attempt()
      }
    },

    async stop(): Promise<void> {
      stopped = true
      releaseResolver?.()
      releaseResolver = undefined
      const current = ctx
      ctx = undefined
      if (current !== undefined) await current.fiber.dispose()
    },
  }
}
