// Account settings section: status + email/password sign-in/up/out against
// the shell's loopback bridge (/desktop/account/*). Tokens stay in the main
// process; this page only ever sees status JSON.
import * as React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { en, zh, type AccountKey } from './locales.ts'

export const inject = ['slots', 'locale']

const NS = 'harness-account'

interface AccountStatus {
  loggedIn: boolean
  email?: string
  offline?: boolean
}

type Translate = (key: AccountKey) => string

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

function AccountSection({ t }: { t: Translate }): React.ReactElement {
  const h = React.createElement
  const [status, setStatus] = React.useState<AccountStatus | undefined>(undefined)
  const [bridgeDown, setBridgeDown] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<AccountKey | undefined>(undefined)

  React.useEffect(() => {
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

  const field = (
    label: string,
    type: string,
    value: string,
    onChange: (value: string) => void,
  ): React.ReactElement => h('label', { style: { display: 'block', marginBottom: 12 } },
    h('div', { style: { marginBottom: 4, opacity: 0.8, fontSize: 13 } }, label),
    h('input', {
      type,
      value,
      autoComplete: 'off',
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
      style: {
        width: '100%', maxWidth: 360, padding: '6px 10px', borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1, #8884)', background: 'transparent', color: 'inherit',
      },
    }))

  const button = (label: string, onClick: () => void, disabled: boolean): React.ReactElement =>
    h('button', {
      type: 'button',
      onClick,
      disabled,
      style: {
        padding: '6px 18px', marginRight: 8, borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
        border: '1px solid var(--dsw-alias-border-l1, #8884)', background: 'transparent', color: 'inherit',
      },
    }, label)

  if (bridgeDown) return h('p', null, t('bridgeUnavailable'))
  if (status === undefined) return h('p', null, t('busy'))

  if (status.loggedIn) {
    return h('div', null,
      h('p', null, `${t('loggedInPrefix')}${status.email ?? ''}${status.offline === true ? t('offlineSuffix') : ''}`),
      button(busy ? t('busy') : t('signOut'), () => act('logout', {}), busy),
      error !== undefined ? h('p', { style: { color: 'var(--dsw-alias-state-error-primary, #c00)' } }, t(error)) : null)
  }

  return h('div', null,
    h('p', null, t('loggedOut')),
    field(t('email'), 'email', email, setEmail),
    field(t('password'), 'password', password, setPassword),
    h('div', null,
      button(busy ? t('busy') : t('signIn'), () => act('login', { email, password }), busy || email === '' || password === ''),
      button(t('signUp'), () => act('register', { email, password }), busy || email === '' || password === '')),
    error !== undefined ? h('p', { style: { color: 'var(--dsw-alias-state-error-primary, #c00)' } }, t(error)) : null)
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'account-ui: copy dictionaries')
  const t = ctx.locale.bind(NS) as Translate
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'harness-account',
    order: 60,
    label: () => t('nav'),
    inject: () => ({ t }),
  }, AccountSection))
}
