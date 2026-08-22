import { Store } from 'lucide-react'
import type { Translate } from './MarketPanel.tsx'

export function SidebarLauncher(props: { wide: boolean; t: Translate; onOpen: () => void }) {
  const { wide, t, onOpen } = props
  return (
    <button
      type="button"
      aria-label={t('nav')}
      title={t('nav')}
      onClick={onOpen}
      className="harness-market-scope"
      style={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        border: 0,
        background: 'transparent',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary, inherit)',
        borderRadius: 6,
        justifyContent: wide ? 'flex-start' : 'center',
        fontSize: 14,
      }}
    >
      <Store size={16} />
      {wide ? <span>{t('nav')}</span> : null}
    </button>
  )
}
