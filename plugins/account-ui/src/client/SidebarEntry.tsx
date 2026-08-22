// Sidebar footer action (renders directly above the Settings row): opens the
// account dialog. In the collapsed rail only the icon shows.
import { UserRound } from 'lucide-react'
import { useState } from 'react'
import { AccountDialog, type Translate } from './AccountDialog.tsx'
import { cn } from './lib/utils.ts'

export function SidebarAccountEntry(props: { wide: boolean; t: Translate }) {
  const { wide, t } = props
  const [open, setOpen] = useState(false)
  return (
    <div className="harness-account-scope">
      <button
        type="button"
        aria-label={t('nav')}
        title={t('nav')}
        onClick={() => setOpen(true)}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-sm text-foreground hover:bg-foreground/5',
          wide ? 'justify-start' : 'justify-center',
        )}
      >
        <UserRound className="size-4 shrink-0" />
        {wide ? <span>{t('nav')}</span> : null}
      </button>
      <AccountDialog t={t} open={open} onOpenChange={setOpen} />
    </div>
  )
}
