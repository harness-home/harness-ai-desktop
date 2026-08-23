// Sidebar footer action opening the market overlay. Shares the shell's
// `harness-sidebar-action` chrome class with the account entry so both stack
// full-width above Settings.
import { Store } from 'lucide-react'
import type { Translate } from './MarketPanel.tsx'

export function SidebarLauncher(props: { wide: boolean; t: Translate; onOpen: () => void }) {
  const { wide, t, onOpen } = props
  return (
    <button
      type="button"
      aria-label={t('nav')}
      title={t('nav')}
      data-rail={wide ? 'false' : 'true'}
      onClick={onOpen}
      className="harness-sidebar-action"
    >
      <Store size={16} />
      {wide ? <span>{t('nav')}</span> : null}
    </button>
  )
}
