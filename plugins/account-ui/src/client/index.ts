// Account settings section registration; the page itself lives in
// AccountSection.tsx.
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AccountSection, type Translate } from './AccountSection.tsx'
import { en, zh } from './locales.ts'

export const inject = ['slots', 'locale']

const NS = 'harness-account'

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'account-ui: copy dictionaries')
  const t = ctx.locale.bind(NS) as Translate
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'harness-account',
    order: 60,
    label: () => t('nav'),
    inject: () => ({ t }),
  }, AccountSection))
}
