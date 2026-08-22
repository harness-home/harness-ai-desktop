// Desktop account service (feature S4): talks to harness-ai-server for
// login/logout/device registration and keeps the bearer token in the system
// secure store (electron safeStorage; red line #7 — never plaintext).
// Being logged out or offline never gates local features (ledger #20): login
// only serves future cloud sync.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import {
  DEVICE_ID_HEADER,
  type DevicePlatform,
  type DeviceRegisterRequest,
  type DeviceRegisterResponse,
  type MeResponse,
} from '@harness-ai/contracts'

/** Bridge status reported to the shell UI. */
export interface AccountStatus {
  loggedIn: boolean
  email?: string
  deviceId?: string
  /** True when logged in per local state but the server was unreachable. */
  offline?: boolean
  serverUrl: string
}

export class AccountError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

interface StoredAccount {
  email: string
  deviceId?: string
  /** base64 of safeStorage.encryptString(token). */
  token: string
}

function desktopPlatform(): DevicePlatform {
  if (process.platform === 'win32') return 'desktop-windows'
  if (process.platform === 'darwin') return 'desktop-macos'
  return 'desktop-linux'
}

export interface AccountServiceOptions {
  serverUrl: string
  storageFile: string
  appVersion: string
}

export class DesktopAccountService {
  private readonly options: AccountServiceOptions

  constructor(options: AccountServiceOptions) {
    this.options = options
  }

  private read(): StoredAccount | undefined {
    try {
      return JSON.parse(readFileSync(this.options.storageFile, 'utf8')) as StoredAccount
    } catch {
      return undefined
    }
  }

  private write(stored: StoredAccount): void {
    mkdirSync(dirname(this.options.storageFile), { recursive: true })
    writeFileSync(this.options.storageFile, JSON.stringify(stored))
  }

  private clear(): void {
    rmSync(this.options.storageFile, { force: true })
  }

  private token(stored: StoredAccount): string {
    return safeStorage.decryptString(Buffer.from(stored.token, 'base64'))
  }

  private async api(
    path: string,
    init: { method?: string; token?: string; deviceId?: string; body?: unknown } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // The server's own origin is always trusted by its origin fence.
      Origin: this.options.serverUrl,
    }
    if (init.token !== undefined) headers.Authorization = `Bearer ${init.token}`
    if (init.deviceId !== undefined) headers[DEVICE_ID_HEADER] = init.deviceId
    try {
      return await fetch(`${this.options.serverUrl}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new AccountError('server_unreachable', `cannot reach ${this.options.serverUrl}`)
    }
  }

  /** Register (or reuse) this installation's device row for the account. */
  private async ensureDevice(token: string, previous: string | undefined): Promise<string> {
    if (previous !== undefined) {
      const probe = await this.api('/api/me', { token, deviceId: previous })
      if (probe.ok) return previous
    }
    const body: DeviceRegisterRequest = {
      name: hostname(),
      platform: desktopPlatform(),
      appVersion: this.options.appVersion,
    }
    const response = await this.api('/api/devices/register', { method: 'POST', token, body })
    if (!response.ok) throw new AccountError('device_register_failed', `device register returned ${String(response.status)}`)
    const registered = (await response.json()) as DeviceRegisterResponse
    return registered.device.deviceId
  }

  async register(email: string, password: string): Promise<AccountStatus> {
    const response = await this.api('/api/auth/sign-up/email', {
      method: 'POST',
      body: { email, password, name: email.split('@')[0] ?? email },
    })
    if (!response.ok) {
      throw new AccountError(response.status === 422 ? 'email_taken' : 'register_failed',
        `sign-up returned ${String(response.status)}`)
    }
    return this.login(email, password)
  }

  async login(email: string, password: string): Promise<AccountStatus> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new AccountError('secure_storage_unavailable', 'system secure storage is unavailable')
    }
    const response = await this.api('/api/auth/sign-in/email', { method: 'POST', body: { email, password } })
    if (!response.ok) {
      throw new AccountError(response.status === 401 ? 'invalid_credentials' : 'login_failed',
        `sign-in returned ${String(response.status)}`)
    }
    const token = response.headers.get('set-auth-token')
    if (token === null || token === '') throw new AccountError('login_failed', 'no bearer token in sign-in response')
    const deviceId = await this.ensureDevice(token, this.read()?.deviceId)
    this.write({ email, deviceId, token: safeStorage.encryptString(token).toString('base64') })
    return { loggedIn: true, email, deviceId, serverUrl: this.options.serverUrl }
  }

  async logout(): Promise<AccountStatus> {
    const stored = this.read()
    if (stored !== undefined) {
      try {
        const token = this.token(stored)
        // Unbind this installation's device row, then revoke the token.
        // Both best effort: local logout must succeed even offline.
        if (stored.deviceId !== undefined) {
          await this.api(`/api/devices/${stored.deviceId}/unbind`, { method: 'POST', token, body: {} })
        }
        await this.api('/api/auth/sign-out', { method: 'POST', token, body: {} })
      } catch {
        // Unreachable server; the local state is still cleared below.
      }
      this.clear()
    }
    return { loggedIn: false, serverUrl: this.options.serverUrl }
  }

  async status(): Promise<AccountStatus> {
    const stored = this.read()
    if (stored === undefined) return { loggedIn: false, serverUrl: this.options.serverUrl }
    try {
      const me = await this.api('/api/me', { token: this.token(stored), deviceId: stored.deviceId })
      if (me.status === 401) {
        // Token revoked server-side; drop the stale local state.
        this.clear()
        return { loggedIn: false, serverUrl: this.options.serverUrl }
      }
      if (me.status === 403) {
        // Device unbound remotely; keep the login but force a re-register on next login.
        this.clear()
        return { loggedIn: false, serverUrl: this.options.serverUrl }
      }
      const view = (await me.json()) as MeResponse
      return {
        loggedIn: true,
        email: view.me.email,
        ...(stored.deviceId === undefined ? {} : { deviceId: stored.deviceId }),
        serverUrl: this.options.serverUrl,
      }
    } catch {
      // Unreachable server: report the cached identity; nothing local is gated.
      return {
        loggedIn: true,
        email: stored.email,
        ...(stored.deviceId === undefined ? {} : { deviceId: stored.deviceId }),
        offline: true,
        serverUrl: this.options.serverUrl,
      }
    }
  }
}
