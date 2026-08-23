// Full-screen market overlay: browse the catalog, install a plugin into the
// desktop profile, remove it again, and restart to load it. Installation runs
// in the main process through the bundled pnpm (see market-routes.ts); this
// page only ever names a catalog listing id.
import type { MarketCategory, MarketListing, MarketListingResponse, MarketListResponse } from '@harness-ai/contracts'
import {
  CheckCircle2, CircleAlert, Download, ExternalLink, LoaderCircle, PackageCheck, RefreshCw, Search, Trash2, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MarketKey } from './locales.ts'
import { Button } from './ui/button.tsx'
import { Input } from './ui/input.tsx'
import { dismissMarketOffer, useMarketOffer } from './store.ts'

export type Translate = (key: MarketKey) => string

type Status = 'loading' | 'ready' | 'unauthenticated' | 'bridge-unavailable'

interface CatalogState {
  status: Status
  listings: MarketListing[]
  categories: MarketCategory[]
}

async function fetchListings(category: MarketCategory | 'all', q: string, installableOnly: boolean): Promise<CatalogState> {
  const params = new URLSearchParams()
  if (category !== 'all') params.set('category', category)
  if (q !== '') params.set('q', q)
  if (installableOnly) params.set('installable', 'true')
  let response: Response
  try {
    response = await fetch(`/desktop/market/listings?${params.toString()}`)
  } catch {
    return { status: 'bridge-unavailable', listings: [], categories: [] }
  }
  if (response.status === 401) return { status: 'unauthenticated', listings: [], categories: [] }
  if (!response.ok) return { status: 'bridge-unavailable', listings: [], categories: [] }
  const body = (await response.json()) as MarketListResponse
  return { status: 'ready', listings: body.listings, categories: body.categories }
}

/** One listing by id, for an install offer whose row is not on the current page. */
async function fetchListing(id: string): Promise<MarketListing | null> {
  try {
    const response = await fetch(`/desktop/market/listing?id=${encodeURIComponent(id)}`)
    if (!response.ok) return null
    return ((await response.json()) as MarketListingResponse).listing
  } catch {
    return null
  }
}

async function fetchInstalled(): Promise<Record<string, string>> {
  try {
    const response = await fetch('/desktop/market/installed')
    if (!response.ok) return {}
    return ((await response.json()) as { installed: Record<string, string> }).installed
  } catch {
    return {}
  }
}

async function post(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetch(`/desktop/market/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await response.json()) as { ok?: boolean; error?: { code: string; message: string } }
    if (!response.ok) return { ok: false, message: json.error?.message ?? json.error?.code ?? 'failed' }
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'failed' }
  }
}

function ListingCard(props: {
  listing: MarketListing
  installedVersion: string | undefined
  busy: boolean
  t: Translate
  onInstall: () => void
  onUninstall: () => void
}) {
  const { listing, installedVersion, busy, t, onInstall, onUninstall } = props
  const installed = installedVersion !== undefined
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{listing.name}</div>
          {listing.packageName === null ? null : (
            <div className="truncate font-mono text-[11px] text-muted-foreground">{listing.packageName}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {listing.preset ? (
            <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">{t('preset')}</span>
          ) : null}
          {listing.source === 'npm' ? (
            <span className="rounded-md bg-foreground/10 px-1.5 py-0.5 text-[11px] text-muted-foreground">{t('community')}</span>
          ) : null}
          {!listing.installable && !listing.preset ? (
            <span className="rounded-md bg-foreground/10 px-1.5 py-0.5 text-[11px] text-muted-foreground">{t('browseOnly')}</span>
          ) : null}
          {installed ? (
            <span className="flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              <CheckCircle2 className="size-3" /> {t('installed')}
            </span>
          ) : null}
        </div>
      </div>

      <p className="line-clamp-3 min-h-[3.4em] text-sm leading-relaxed text-muted-foreground">{listing.description}</p>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="truncate">
          {t(`category.${listing.category}` as MarketKey)}
          {listing.author === null ? '' : ` · ${listing.author}`}
          {listing.version === null ? '' : ` · v${listing.version}`}
          {listing.downloads === null ? '' : ` · ${listing.downloads.toLocaleString()} ${t('downloads')}`}
          {listing.license === null ? '' : ` · ${listing.license}`}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {listing.homepage === null ? null : (
            <a
              href={listing.homepage}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-primary hover:bg-primary/10"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
          {listing.preset ? (
            <span className="flex items-center gap-1 px-1.5 py-1 text-muted-foreground">
              <PackageCheck className="size-3.5" /> {t('bundled')}
            </span>
          ) : installed ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={onUninstall}>
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              {t('uninstall')}
            </Button>
          ) : (
            <Button size="sm" disabled={busy || listing.packageName === null || !listing.installable} onClick={onInstall}>
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {t('install')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

type OfferState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; listing: MarketListing }

/**
 * Confirmation banner for an install a deep link asked for. The link named only
 * a catalog id; this resolves it and shows what would be installed, and nothing
 * happens until the button below is pressed.
 */
function InstallOffer(props: {
  offer: OfferState
  busy: boolean
  t: Translate
  onConfirm: (listing: MarketListing) => void
  onDismiss: () => void
}) {
  const { offer, busy, t, onConfirm, onDismiss } = props
  const listing = offer.status === 'ready' ? offer.listing : undefined
  const blocked = listing !== undefined && (!listing.installable || listing.packageName === null || listing.preset)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-primary/10 px-6 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Download className="size-4 text-primary" />
          {t('offer.title')}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {offer.status === 'loading'
            ? t('offer.loading')
            : offer.status === 'missing'
              ? t('offer.missing')
              : blocked
                ? t('offer.notInstallable')
                : t('offer.body')}
        </p>
        {listing === undefined ? null : (
          <p className="mt-1 truncate text-sm text-foreground">
            <span className="font-medium">{listing.name}</span>
            {listing.packageName === null ? '' : ` · ${listing.packageName}`}
            {listing.version === null ? '' : `@${listing.version}`}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={onDismiss}>{t('offer.dismiss')}</Button>
        <Button
          size="sm"
          disabled={busy || listing === undefined || blocked}
          onClick={() => { if (listing !== undefined) onConfirm(listing) }}
        >
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {t('offer.confirm')}
        </Button>
      </div>
    </div>
  )
}

export function MarketPanel(props: { t: Translate; onClose: () => void }) {
  const { t, onClose } = props
  const [category, setCategory] = useState<MarketCategory | 'all'>('all')
  const [q, setQ] = useState('')
  const [installableOnly, setInstallableOnly] = useState(false)
  const [state, setState] = useState<CatalogState>({ status: 'loading', listings: [], categories: [] })
  const [installed, setInstalled] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | undefined>(undefined)
  const [message, setMessage] = useState<{ kind: 'error' | 'restart'; text: string } | undefined>(undefined)
  const offeredId = useMarketOffer()
  const [offer, setOffer] = useState<OfferState | undefined>(undefined)

  const reloadInstalled = useCallback(() => { void fetchInstalled().then(setInstalled) }, [])

  useEffect(() => {
    let cancelled = false
    setState((prev) => ({ ...prev, status: 'loading' }))
    const timer = setTimeout(() => {
      void fetchListings(category, q, installableOnly).then((next) => { if (!cancelled) setState(next) })
    }, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [category, q, installableOnly])

  useEffect(reloadInstalled, [reloadInstalled])

  // Resolve the listing a deep link offered, so the confirmation shows what it
  // actually is rather than an opaque id.
  useEffect(() => {
    if (offeredId === undefined) {
      setOffer(undefined)
      return
    }
    let cancelled = false
    setOffer({ status: 'loading' })
    void fetchListing(offeredId).then((listing) => {
      if (cancelled) return
      setOffer(listing === null ? { status: 'missing' } : { status: 'ready', listing })
    })
    return () => { cancelled = true }
  }, [offeredId])

  // Escape closes the overlay, matching every other full-frame surface.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const categories = useMemo<(MarketCategory | 'all')[]>(() => ['all', ...state.categories], [state.categories])

  const act = (id: string, run: () => Promise<{ ok: boolean; message?: string }>): void => {
    setBusyId(id)
    setMessage(undefined)
    void run().then((result) => {
      if (result.ok) {
        reloadInstalled()
        setMessage({ kind: 'restart', text: t('restartHint') })
      } else {
        setMessage({ kind: 'error', text: result.message ?? t('actionFailed') })
      }
    }).finally(() => setBusyId(undefined))
  }

  return (
    <div className="harness-market-scope fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label={t('close')} onClick={onClose}>
          <X className="size-5" />
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <div className="relative min-w-[220px] flex-1 md:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('searchPlaceholder')} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCategory(option)}
              className={`cursor-pointer rounded-md border px-2.5 py-1 text-sm transition-colors ${
                option === category
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-foreground/5'
              }`}
            >
              {option === 'all' ? t('categoryAll') : t(`category.${option}` as MarketKey)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setInstallableOnly((value) => !value)}
          className={`cursor-pointer rounded-md border px-2.5 py-1 text-sm transition-colors ${
            installableOnly ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-foreground/5'
          }`}
        >
          {t('installableOnly')}
        </button>
      </div>

      {offer === undefined ? null : (
        <InstallOffer
          offer={offer}
          busy={offer.status === 'ready' && busyId === offer.listing.id}
          t={t}
          onConfirm={(listing) => {
            act(listing.id, () => post('install', { id: listing.id }))
            dismissMarketOffer()
          }}
          onDismiss={dismissMarketOffer}
        />
      )}

      {message === undefined ? null : (
        <div className={`flex items-center justify-between gap-3 border-b border-border px-6 py-2.5 text-sm ${
          message.kind === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-foreground'
        }`}
        >
          <span className="flex items-center gap-2">
            {message.kind === 'error' ? <CircleAlert className="size-4" /> : <CheckCircle2 className="size-4 text-primary" />}
            {message.text}
          </span>
          {message.kind === 'restart' ? (
            <Button size="sm" onClick={() => { void post('restart', {}) }}>
              <RefreshCw className="size-3.5" /> {t('restartNow')}
            </Button>
          ) : null}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {state.status === 'loading' ? (
          <p className="flex items-center gap-2 text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t('loading')}</p>
        ) : state.status === 'unauthenticated' ? (
          <p className="text-muted-foreground">{t('unauthenticated')}</p>
        ) : state.status === 'bridge-unavailable' ? (
          <p className="text-muted-foreground">{t('bridgeUnavailable')}</p>
        ) : state.listings.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {state.listings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                installedVersion={listing.packageName === null ? undefined : installed[listing.packageName]}
                busy={busyId === listing.id}
                t={t}
                onInstall={() => act(listing.id, () => post('install', { id: listing.id }))}
                onUninstall={() => act(listing.id, () => post('uninstall', { packageName: listing.packageName }))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
