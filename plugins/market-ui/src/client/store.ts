// Tiny shared open-state store so the sidebar launcher and the overlay seat —
// two independently rendered slots — coordinate without a shared React tree.
import { useSyncExternalStore } from 'react'

let open = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function setMarketOpen(next: boolean): void {
  if (open === next) return
  open = next
  emit()
}

export function useMarketOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => open,
  )
}
