// Loopback bridge for the market UI: proxies the read-only catalog on
// harness-ai-server (injecting the account bearer token in the main process so
// the renderer never sees it) and performs profile plugin installs through the
// bundled pnpm — the same path `dsh plugin add` uses.
//
// Only packages the catalog serves can be installed: the UI sends a listing id,
// the bridge resolves that id against the server and installs the package name
// the server returned, so a renderer can never name an arbitrary package.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { MarketListingResponse } from '@harness-ai/contracts'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { DesktopAccountService } from '../account/service'
import { installPlugin, installedPlugins, uninstallPlugin } from './plugin-install'
import { forgetQuarantine, readQuarantine, releaseQuarantine } from './profile-plugins'

const JSON_TYPE = 'application/json'

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': JSON_TYPE })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export interface MarketRouteOptions {
  account: DesktopAccountService
  /** Application root (anchors the bundled pnpm). */
  appRoot: string
  /** The desktop profile directory plugins install into. */
  profileDir: string
  /** Ask the shell to restart so a freshly installed plugin is loaded. */
  requestRestart: () => void
}

/** Register the /desktop/market/* routes once the web server is up. */
export function registerMarketRoutes(ctx: Context, options: MarketRouteOptions): void {
  ctx.inject(['webServer'], (webCtx) => {
    const ownOrigins = new Set([
      `http://127.0.0.1:${String(webCtx.webServer.port)}`,
      `http://localhost:${String(webCtx.webServer.port)}`,
    ])
    const { account } = options

    const guard = (req: IncomingMessage, res: ServerResponse, method: 'GET' | 'POST'): boolean => {
      if (req.method !== method) {
        send(res, 405, { error: { code: 'method_not_allowed', message: `${method} only` } })
        return false
      }
      const origin = req.headers.origin
      if (origin !== undefined && !ownOrigins.has(origin)) {
        send(res, 403, { error: { code: 'forbidden_origin', message: 'cross-origin rejected' } })
        return false
      }
      if (method === 'POST') {
        const mediaType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
        if (mediaType !== JSON_TYPE) {
          send(res, 415, { error: { code: 'unsupported_media_type', message: 'content type must be application/json' } })
          return false
        }
      }
      return true
    }

    const upstream = async (path: string): Promise<{ status: number; text: string }> => {
      const auth = account.auth()
      if (auth === undefined) {
        return {
          status: 401,
          text: JSON.stringify({ error: { code: 'unauthenticated', message: 'sign in to browse the market' } }),
        }
      }
      try {
        const response = await fetch(`${account.serverUrl}${path}`, {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            Origin: account.serverUrl,
            ...(auth.deviceId === undefined ? {} : { 'x-harness-device-id': auth.deviceId }),
          },
          signal: AbortSignal.timeout(15_000),
        })
        return { status: response.status, text: await response.text() }
      } catch {
        return {
          status: 502,
          text: JSON.stringify({ error: { code: 'server_unreachable', message: 'cannot reach the market server' } }),
        }
      }
    }

    const route = (
      path: string,
      method: 'GET' | 'POST',
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
    ): void => {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'exact',
        path,
        handler: (req, res) => {
          if (!guard(req, res, method)) return
          void handler(req, res).catch((error: unknown) => {
            send(res, 500, { error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } })
          })
        },
      }), `market bridge: ${path}`)
    }

    route('/desktop/market/listings', 'GET', async (req, res) => {
      const query = req.url?.includes('?') === true ? req.url.slice(req.url.indexOf('?')) : ''
      const result = await upstream(`/api/market/listings${query}`)
      res.writeHead(result.status, { 'Content-Type': JSON_TYPE })
      res.end(result.text)
    })

    /**
     * One listing by id. Used when a deep link names a listing the current
     * catalog page does not contain, so the install offer can show what it is
     * about before the user confirms.
     */
    route('/desktop/market/listing', 'GET', async (req, res) => {
      const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('id') ?? ''
      if (id === '') {
        send(res, 400, { error: { code: 'bad_request', message: 'listing id is required' } })
        return
      }
      const result = await upstream(`/api/market/listings/${encodeURIComponent(id)}`)
      res.writeHead(result.status, { 'Content-Type': JSON_TYPE })
      res.end(result.text)
    })

    /** Locally installed plugin packages, so the UI can mark catalog rows. */
    route('/desktop/market/installed', 'GET', async (_req, res) => {
      send(res, 200, { installed: installedPlugins(options.profileDir) })
    })

    /**
     * Plugins the shell disabled because they could not load. Surfaced so a
     * silently degraded client is visible to the user instead of a plugin that
     * simply stopped working.
     */
    route('/desktop/market/quarantined', 'GET', async (_req, res) => {
      send(res, 200, { entries: readQuarantine(options.profileDir) })
    })

    /** Clear a quarantine after the user reinstalled or repaired the plugin. */
    route('/desktop/market/enable', 'POST', async (req, res) => {
      const payload = JSON.parse(await readBody(req)) as { packageName?: unknown }
      const packageName = typeof payload.packageName === 'string' ? payload.packageName : ''
      if (packageName === '') {
        send(res, 400, { error: { code: 'bad_request', message: 'package name is required' } })
        return
      }
      if (!releaseQuarantine(options.profileDir, packageName)) {
        send(res, 409, {
          error: { code: 'still_broken', message: 'the plugin still cannot be loaded; reinstall or remove it' },
        })
        return
      }
      send(res, 200, { ok: true, restartRequired: true })
    })

    route('/desktop/market/install', 'POST', async (req, res) => {
      const payload = JSON.parse(await readBody(req)) as { id?: unknown }
      const id = typeof payload.id === 'string' ? payload.id : ''
      if (id === '') {
        send(res, 400, { error: { code: 'bad_request', message: 'listing id is required' } })
        return
      }
      const listing = await upstream(`/api/market/listings/${encodeURIComponent(id)}`)
      if (listing.status !== 200) {
        res.writeHead(listing.status, { 'Content-Type': JSON_TYPE })
        res.end(listing.text)
        return
      }
      const view = (JSON.parse(listing.text) as MarketListingResponse).listing
      if (view.packageName === null) {
        send(res, 400, { error: { code: 'not_installable', message: 'this listing names no package' } })
        return
      }
      if (view.preset) {
        send(res, 400, { error: { code: 'preset_bundled', message: 'preset plugins ship with the app' } })
        return
      }
      const result = await installPlugin(options.appRoot, options.profileDir, view.packageName, view.version)
      if (!result.ok) {
        send(res, 502, { error: { code: result.code ?? 'install_failed', message: result.detail ?? 'install failed' } })
        return
      }
      send(res, 200, { ok: true, restartRequired: true })
    })

    route('/desktop/market/uninstall', 'POST', async (req, res) => {
      const payload = JSON.parse(await readBody(req)) as { packageName?: unknown }
      const packageName = typeof payload.packageName === 'string' ? payload.packageName : ''
      if (packageName === '' || !(packageName in installedPlugins(options.profileDir))) {
        send(res, 400, { error: { code: 'not_installed', message: 'this package is not installed in the profile' } })
        return
      }
      const result = await uninstallPlugin(options.appRoot, options.profileDir, packageName)
      // A plugin that is gone must stop being reported as disabled.
      if (result.ok) forgetQuarantine(options.profileDir, packageName)
      if (!result.ok) {
        send(res, 502, { error: { code: result.code ?? 'uninstall_failed', message: result.detail ?? 'uninstall failed' } })
        return
      }
      send(res, 200, { ok: true, restartRequired: true })
    })

    route('/desktop/market/restart', 'POST', async (_req, res) => {
      send(res, 200, { ok: true })
      setTimeout(() => options.requestRestart(), 200)
    })
  })
}
