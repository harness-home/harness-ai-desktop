// Loopback HTTP bridge for the account UI: private routes on the dsh web
// server (the shell's IPC replacement, same pattern as the reference shell).
// Tokens never leave the main process — the renderer only sees status JSON.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { AccountError, type DesktopAccountService } from '../account/service'

const JSON_TYPE = 'application/json'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': JSON_TYPE })
  res.end(JSON.stringify(body))
}

/** Register the /desktop/account/* routes once the web server is up. */
export function registerAccountRoutes(ctx: Context, account: DesktopAccountService): void {
  ctx.inject(['webServer'], (webCtx) => {
    const ownOrigins = new Set([
      `http://127.0.0.1:${String(webCtx.webServer.port)}`,
      `http://localhost:${String(webCtx.webServer.port)}`,
    ])

    const route = (
      path: string,
      method: 'GET' | 'POST',
      handle: (payload: Record<string, unknown>) => Promise<unknown>,
    ): void => {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          if (req.method !== method) return send(res, 405, { error: { code: 'method_not_allowed', message: 'wrong method' } })
          // Cross-site write fence (mirrors the dsh /api carrier): POSTs must
          // be JSON — a foreign page cannot send that without a preflight this
          // server never answers — and any Origin present must be our own.
          const origin = req.headers.origin
          if (origin !== undefined && !ownOrigins.has(origin)) {
            return send(res, 403, { error: { code: 'forbidden_origin', message: 'cross-origin call rejected' } })
          }
          let payload: Record<string, unknown> = {}
          if (method === 'POST') {
            const mediaType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
            if (mediaType !== JSON_TYPE) {
              return send(res, 415, { error: { code: 'unsupported_media_type', message: 'content type must be application/json' } })
            }
            try {
              const raw = await readBody(req)
              payload = raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>)
            } catch {
              return send(res, 400, { error: { code: 'bad_request', message: 'body is not JSON' } })
            }
          }
          try {
            send(res, 200, await handle(payload))
          } catch (error) {
            if (error instanceof AccountError) {
              return send(res, 400, { error: { code: error.code, message: error.message } })
            }
            send(res, 500, { error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } })
          }
        },
      }), `account bridge: ${path}`)
    }

    route('/desktop/account/status', 'GET', async () => account.status())
    route('/desktop/account/login', 'POST', async (payload) => {
      const email = typeof payload.email === 'string' ? payload.email : ''
      const password = typeof payload.password === 'string' ? payload.password : ''
      if (email === '' || password === '') throw new AccountError('bad_request', 'email and password are required')
      return account.login(email, password)
    })
    route('/desktop/account/register', 'POST', async (payload) => {
      const email = typeof payload.email === 'string' ? payload.email : ''
      const password = typeof payload.password === 'string' ? payload.password : ''
      if (email === '' || password === '') throw new AccountError('bad_request', 'email and password are required')
      return account.register(email, password)
    })
    route('/desktop/account/logout', 'POST', async () => account.logout())
  })
}
