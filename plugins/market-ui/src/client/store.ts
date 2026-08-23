// Tiny shared store so the sidebar launcher, the overlay seat and the deep-link
// subscription — all rendered or registered independently — coordinate without
// a shared React tree.
import { useSyncExternalStore } from 'react'

let open = false
/** Catalog listing a deep link offered to install, awaiting the user's decision. */
let offeredListingId: string | undefined
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setMarketOpen(next: boolean): void {
  if (open === next) return
  open = next
  // Closing the panel drops any pending offer: the user walked away from it.
  if (!open) offeredListingId = undefined
  emit()
}

export function useMarketOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open)
}

/** Open the market with an install offer for one catalog listing. */
export function offerMarketInstall(listingId: string): void {
  offeredListingId = listingId
  open = true
  emit()
}

export function dismissMarketOffer(): void {
  if (offeredListingId === undefined) return
  offeredListingId = undefined
  emit()
}

export function useMarketOffer(): string | undefined {
  return useSyncExternalStore(subscribe, () => offeredListingId)
}
