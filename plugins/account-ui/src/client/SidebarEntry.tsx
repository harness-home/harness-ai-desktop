// Sidebar footer action (renders directly above the Settings row): opens the
// account dialog. Layout comes from the shell's chrome stylesheet via the
// shared `harness-sidebar-action` class, so every shell entry stacks
// full-width and matches the Settings row in both sidebar widths.
import { UserRound } from 'lucide-react'
import { useState } from 'react'
import { AccountDialog, type Translate } from './AccountDialog.tsx'

export function SidebarAccountEntry(props: { wide: boolean; t: Translate }) {
  const { wide, t } = props
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={t('nav')}
        title={t('nav')}
        data-rail={wide ? 'false' : 'true'}
        onClick={() => setOpen(true)}
        className="harness-sidebar-action"
      >
        <UserRound size={16} />
        {wide ? <span>{t('nav')}</span> : null}
      </button>
      <AccountDialog t={t} open={open} onOpenChange={setOpen} />
    </>
  )
}
