// Loopback bridge for application updates: lets the embedded UI read update
// state and act on it without any privilege of its own. Same origin gate as the
// other shell bridges — only the runtime's own pages may call it.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { checkForUpdates, installUpdate, updateStatus } from '../updater'

const JSON_TYPE = 'application/json'

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': JSON_TYPE })
  res.end(JSON.stringify(body))
}

/** Register the /desktop/update/* routes once the web server is up. */
export function registerUpdateRoutes(ctx: Context): void {
  ctx.inject(['webServer'], (webCtx) => {
    const ownOrigins = new Set([
      `http://127.0.0.1:${String(webCtx.webServer.port)}`,
      `http://localhost:${String(webCtx.webServer.port)}`,
    ])

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
      return true
    }

    const route = (
      path: string,
      method: 'GET' | 'POST',
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
    ): void => {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'exact',
        path,
        handler: (req, res) => {
          if (!guard(req, res, method)) return
          void Promise.resolve(handler(req, res)).catch((error: unknown) => {
            send(res, 500, {
              error: { code: 'internal', message: error instanceof Error ? error.message : String(error) },
            })
          })
        },
      }), `update bridge: ${path}`)
    }

    route('/desktop/update/status', 'GET', (_req, res) => {
      send(res, 200, { update: updateStatus() })
    })

    route('/desktop/update/check', 'POST', async (_req, res) => {
      send(res, 200, { update: await checkForUpdates() })
    })

    route('/desktop/update/install', 'POST', (_req, res) => {
      if (!installUpdate()) {
        send(res, 409, { error: { code: 'no_update_staged', message: 'no update is ready to install' } })
        return
      }
      send(res, 200, { ok: true })
    })
  })
}
