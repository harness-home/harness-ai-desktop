import { MarketPanel, type Translate } from './MarketPanel.tsx'
import { setMarketOpen, useMarketOpen } from './store.ts'

export function OverlaySeat({ t }: { t: Translate }) {
  const open = useMarketOpen()
  if (!open) return null
  return <MarketPanel t={t} onClose={() => setMarketOpen(false)} />
}
