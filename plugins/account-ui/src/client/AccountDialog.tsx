// Account dialog: sign-in / sign-up when logged out, identity card + device
// and server facts when logged in. Talks only to the shell's loopback bridge
// (/desktop/account/*); tokens never reach this page.
import { CircleAlert, LoaderCircle, ServerCog, UserRound } from 'lucide-react'
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
  deviceId?: string
  offline?: boolean
  serverUrl?: string
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-[11px] text-foreground">{value}</span>
    </div>
  )
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

  const errorRow = error === undefined ? null : (
    <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{t(error)}</span>
    </p>
  )

  let body: React.JSX.Element
  if (bridgeDown) {
    body = <DialogDescription>{t('bridgeUnavailable')}</DialogDescription>
  } else if (status === undefined) {
    body = (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> {t('busy')}
      </div>
    )
  } else if (status.loggedIn) {
    body = (
      <>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <UserRound className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{status.email}</div>
            <div className={`truncate text-xs ${status.offline === true ? 'text-destructive' : 'text-muted-foreground'}`}>
              {status.offline === true ? t('statusOffline') : t('statusOnline')}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {status.serverUrl === undefined ? null : <Fact label={t('server')} value={status.serverUrl} />}
          {status.deviceId === undefined ? null : <Fact label={t('device')} value={status.deviceId.slice(0, 8)} />}
        </div>
        {errorRow}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => act('logout', {})}>
            {busy ? t('busy') : t('signOut')}
          </Button>
        </DialogFooter>
      </>
    )
  } else {
    const incomplete = busy || email.trim() === '' || password === ''
    body = (
      <>
        <DialogDescription>{t('signedOutBody')}</DialogDescription>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="harness-account-email">{t('email')}</Label>
            <Input
              id="harness-account-email"
              type="email"
              autoComplete="off"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="harness-account-password">{t('password')}</Label>
            <Input
              id="harness-account-password"
              type="password"
              autoComplete="off"
              placeholder={t('passwordPlaceholder')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !incomplete) act('login', { email: email.trim(), password })
              }}
            />
          </div>
        </div>
        {errorRow}
        <DialogFooter>
          <Button variant="outline" disabled={incomplete} onClick={() => act('register', { email: email.trim(), password })}>
            {t('signUp')}
          </Button>
          <Button disabled={incomplete} onClick={() => act('login', { email: email.trim(), password })}>
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
          <DialogTitle className="flex items-center gap-2">
            <ServerCog className="size-4 text-muted-foreground" />
            {status?.loggedIn === true ? t('signedInTitle') : t('signedOutTitle')}
          </DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}
