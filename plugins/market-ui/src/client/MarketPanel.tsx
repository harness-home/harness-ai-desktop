// Full-screen market overlay: category filter + search over the read-only
// catalog served through the shell's /desktop/market bridge. No install path
// (ledger M4) — cards are display-only, with a homepage link.
import type { MarketCategory, MarketListing, MarketListResponse } from '@harness-ai/contracts'
import { ExternalLink, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { MarketKey } from './locales.ts'
import { Button } from './ui/button.tsx'
import { Input } from './ui/input.tsx'

export type Translate = (key: MarketKey) => string

interface MarketState {
  status: 'loading' | 'ready' | 'unauthenticated' | 'bridge-unavailable'
  listings: MarketListing[]
  categories: MarketCategory[]
}

async function fetchListings(category: MarketCategory | 'all', q: string): Promise<MarketState> {
  const params = new URLSearchParams()
  if (category !== 'all') params.set('category', category)
  if (q !== '') params.set('q', q)
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

function ListingCard({ listing, t }: { listing: MarketListing; t: Translate }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{listing.name}</div>
          {listing.packageName !== null ? (
            <div className="truncate text-xs text-muted-foreground">{listing.packageName}</div>
          ) : null}
        </div>
        {listing.preset ? (
          <span className="shrink-0 rounded-sm bg-primary/15 px-1.5 py-0.5 text-xs text-primary">{t('preset')}</span>
        ) : null}
      </div>
      <p className="line-clamp-3 text-sm text-muted-foreground">{listing.description}</p>
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{t(`category.${listing.category}` as MarketKey)}{listing.author === null ? '' : ` · ${listing.author}`}</span>
        {listing.homepage !== null ? (
          <a href={listing.homepage} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary">
            {t('homepage')} <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
    </div>
  )
}

export function MarketPanel(props: { t: Translate; onClose: () => void }) {
  const { t, onClose } = props
  const [category, setCategory] = useState<MarketCategory | 'all'>('all')
  const [q, setQ] = useState('')
  const [state, setState] = useState<MarketState>({ status: 'loading', listings: [], categories: [] })

  useEffect(() => {
    let cancelled = false
    setState((prev) => ({ ...prev, status: 'loading' }))
    const timer = setTimeout(() => {
      void fetchListings(category, q).then((next) => {
        if (!cancelled) setState(next)
      })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [category, q])

  const categories = useMemo<(MarketCategory | 'all')[]>(
    () => ['all', ...state.categories],
    [state.categories],
  )

  return (
    <div className="harness-market-scope fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <div className="text-xl font-semibold text-foreground">{t('title')}</div>
          <div className="text-sm text-muted-foreground">{t('subtitle')}</div>
        </div>
        <Button variant="ghost" size="icon" aria-label={t('close')} onClick={onClose}>
          <X className="size-5" />
        </Button>
      </div>

      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCategory(option)}
              className={`rounded-md px-2.5 py-1 text-sm ${
                option === category
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-foreground/5'
              }`}
            >
              {option === 'all' ? t('categoryAll') : t(`category.${option}` as MarketKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {state.status === 'loading' ? (
          <p className="text-muted-foreground">{t('loading')}</p>
        ) : state.status === 'unauthenticated' ? (
          <p className="text-muted-foreground">{t('unauthenticated')}</p>
        ) : state.status === 'bridge-unavailable' ? (
          <p className="text-muted-foreground">{t('bridgeUnavailable')}</p>
        ) : state.listings.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {state.listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
