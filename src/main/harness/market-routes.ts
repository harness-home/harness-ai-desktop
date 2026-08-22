// Loopback bridge for the market UI: proxies the read-only market catalog on
// harness-ai-server, injecting the account's bearer token in the main process
// so the renderer never sees it. Same private-route pattern as the account
// bridge (workspace red line #7).
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { DesktopAccountService } from '../account/service'

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Register /desktop/market/* proxy routes once the web server is up. */
export function registerMarketRoutes(ctx: Context, account: DesktopAccountService): void {
  ctx.inject(['webServer'], (webCtx) => {
    const ownOrigins = new Set([
      `http://127.0.0.1:${String(webCtx.webServer.port)}`,
      `http://localhost:${String(webCtx.webServer.port)}`,
    ])
    const proxy = async (req: IncomingMessage, res: ServerResponse, upstreamPath: string): Promise<void> => {
      if (req.method !== 'GET') return send(res, 405, { error: { code: 'method_not_allowed', message: 'GET only' } })
      const origin = req.headers.origin
      if (origin !== undefined && !ownOrigins.has(origin)) {
        return send(res, 403, { error: { code: 'forbidden_origin', message: 'cross-origin rejected' } })
      }
      const auth = account.auth()
      if (auth === undefined) return send(res, 401, { error: { code: 'unauthenticated', message: 'sign in to browse the market' } })
      try {
        const upstream = await fetch(`${account.serverUrl}${upstreamPath}`, {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            Origin: account.serverUrl,
            ...(auth.deviceId === undefined ? {} : { 'x-harness-device-id': auth.deviceId }),
          },
          signal: AbortSignal.timeout(15_000),
        })
        const text = await upstream.text()
        res.writeHead(upstream.status, { 'Content-Type': 'application/json' })
        res.end(text)
      } catch {
        send(res, 502, { error: { code: 'server_unreachable', message: 'cannot reach the market server' } })
      }
    }

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/desktop/market/listings',
      handler: (req, res) => {
        const query = req.url?.includes('?') === true ? req.url.slice(req.url.indexOf('?')) : ''
        void proxy(req, res, `/api/market/listings${query}`)
      },
    }), 'market bridge: listings')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/desktop/market/listing',
      handler: (req, res) => {
        const id = decodeURIComponent((req.url ?? '').split('/').pop()?.split('?')[0] ?? '')
        void proxy(req, res, `/api/market/listings/${encodeURIComponent(id)}`)
      },
    }), 'market bridge: listing detail')
  })
}
