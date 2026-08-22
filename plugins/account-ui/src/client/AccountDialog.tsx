// Account dialog: sign-in / sign-up form when logged out, account summary +
// sign-out when logged in. Talks only to the shell's loopback bridge
// (/desktop/account/*); tokens never reach this page.
import { useEffect, useState } from 'react'
import type * as React from 'react'
import { en, type AccountKey } from './locales.ts'
import { Button } from './ui/button.tsx'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from './ui/dialog.tsx'
import { Input } from './ui/input.tsx'
import { Label } from './ui/label.tsx'

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

export function AccountDialog(props: {
  t: Translate
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, open, onOpenChange } = props
  const [status, setStatus] = useState<AccountStatus | undefined>(undefined)
  const [bridgeDown, setBridgeDown] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AccountKey | undefined>(undefined)

  useEffect(() => {
    if (!open) return
    setError(undefined)
    bridge('status').then(setStatus, () => setBridgeDown(true))
  }, [open])

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

  const formIncomplete = busy || email === '' || password === ''

  let body: React.JSX.Element
  if (bridgeDown) {
    body = <DialogDescription>{t('bridgeUnavailable')}</DialogDescription>
  } else if (status === undefined) {
    body = <DialogDescription>{t('busy')}</DialogDescription>
  } else if (status.loggedIn) {
    body = (
      <>
        <DialogDescription>
          {`${t('loggedInPrefix')}${status.email ?? ''}${status.offline === true ? t('offlineSuffix') : ''}`}
        </DialogDescription>
        {error !== undefined ? <p className="text-sm text-destructive">{t(error)}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => act('logout', {})}>
            {busy ? t('busy') : t('signOut')}
          </Button>
        </DialogFooter>
      </>
    )
  } else {
    body = (
      <>
        <DialogDescription>{t('loggedOut')}</DialogDescription>
        <div className="grid gap-2">
          <Label htmlFor="harness-account-email">{t('email')}</Label>
          <Input
            id="harness-account-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="harness-account-password">{t('password')}</Label>
          <Input
            id="harness-account-password"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error !== undefined ? <p className="text-sm text-destructive">{t(error)}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={formIncomplete} onClick={() => act('register', { email, password })}>
            {t('signUp')}
          </Button>
          <Button disabled={formIncomplete} onClick={() => act('login', { email, password })}>
            {busy ? t('busy') : t('signIn')}
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('nav')}</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}
