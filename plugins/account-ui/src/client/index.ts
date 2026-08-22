// Account entry registration: one sidebar footer action (the seat that stacks
// directly above Settings) opening the login dialog. The page components live
// in SidebarEntry.tsx / AccountDialog.tsx.
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { Translate } from './AccountDialog.tsx'
import { SidebarAccountEntry } from './SidebarEntry.tsx'
import { en, zh } from './locales.ts'

export const inject = ['slots', 'locale']

const NS = 'harness-account'

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'account-ui: copy dictionaries')
  const t = ctx.locale.bind(NS) as Translate
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'harness-account',
    inject: () => ({ t }),
  }, SidebarAccountEntry))
}
