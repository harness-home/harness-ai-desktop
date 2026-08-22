// Account settings page: status + email/password sign-in/up/out against the
// shell's loopback bridge (/desktop/account/*). Tokens stay in the main
// process; this page only ever sees status JSON.
import { useEffect, useState } from 'react'
import type * as React from 'react'
import { en, type AccountKey } from './locales.ts'

export interface AccountStatus {
  loggedIn: boolean
  email?: string
  offline?: boolean
}

export type Translate = (key: AccountKey) => string

async function bridge(path: string, body?: Record<string, unknown>): Promise<AccountStatus> {
  const response = await fetch(`/desktop/account/${path}`, body === undefined
    ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await response.json()) as AccountStatus & { error?: { code: string } }
  if (!response.ok) throw new Error(json.error?.code ?? 'generic')
  return json
}

function errorKey(error: unknown): AccountKey {
  const code = error instanceof Error ? error.message : 'generic'
  const key = `error.${code}` as AccountKey
  return key in en ? key : 'error.generic'
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 360,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l1, #8884)',
  background: 'transparent',
  color: 'inherit',
}

const buttonStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '6px 18px',
  marginRight: 8,
  borderRadius: 6,
  cursor: disabled ? 'default' : 'pointer',
  border: '1px solid var(--dsw-alias-border-l1, #8884)',
  background: 'transparent',
  color: 'inherit',
})

const errorStyle: React.CSSProperties = { color: 'var(--dsw-alias-state-error-primary, #c00)' }

function Field(props: {
  label: string
  type: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ marginBottom: 4, opacity: 0.8, fontSize: 13 }}>{props.label}</div>
      <input
        type={props.type}
        value={props.value}
        autoComplete="off"
        onChange={(event) => props.onChange(event.target.value)}
        style={inputStyle}
      />
    </label>
  )
}

export function AccountSection({ t }: { t: Translate }) {
  const [status, setStatus] = useState<AccountStatus | undefined>(undefined)
  const [bridgeDown, setBridgeDown] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AccountKey | undefined>(undefined)

  useEffect(() => {
    bridge('status').then(setStatus, () => setBridgeDown(true))
  }, [])

  const act = (path: string, body?: Record<string, unknown>): void => {
    setBusy(true)
    setError(undefined)
    bridge(path, body)
      .then((next) => {
        setStatus(next)
        setPassword('')
      })
      .catch((cause: unknown) => setError(errorKey(cause)))
      .finally(() => setBusy(false))
  }

  if (bridgeDown) return <p>{t('bridgeUnavailable')}</p>
  if (status === undefined) return <p>{t('busy')}</p>

  if (status.loggedIn) {
    return (
      <div>
        <p>{`${t('loggedInPrefix')}${status.email ?? ''}${status.offline === true ? t('offlineSuffix') : ''}`}</p>
        <button type="button" disabled={busy} style={buttonStyle(busy)} onClick={() => act('logout', {})}>
          {busy ? t('busy') : t('signOut')}
        </button>
        {error !== undefined ? <p style={errorStyle}>{t(error)}</p> : null}
      </div>
    )
  }

  const formIncomplete = busy || email === '' || password === ''
  return (
    <div>
      <p>{t('loggedOut')}</p>
      <Field label={t('email')} type="email" value={email} onChange={setEmail} />
      <Field label={t('password')} type="password" value={password} onChange={setPassword} />
      <div>
        <button type="button" disabled={formIncomplete} style={buttonStyle(formIncomplete)}
          onClick={() => act('login', { email, password })}>
          {busy ? t('busy') : t('signIn')}
        </button>
        <button type="button" disabled={formIncomplete} style={buttonStyle(formIncomplete)}
          onClick={() => act('register', { email, password })}>
          {t('signUp')}
        </button>
      </div>
      {error !== undefined ? <p style={errorStyle}>{t(error)}</p> : null}
    </div>
  )
}
