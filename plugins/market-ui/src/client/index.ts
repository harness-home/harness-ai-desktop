// Plugin market entry: a sidebar footer action opens the market overlay
// (shell.overlay, the shipped full-frame additive seat). Components live in
// SidebarLauncher.tsx / OverlaySeat.tsx / MarketPanel.tsx.
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { Translate } from './MarketPanel.tsx'
import { OverlaySeat } from './OverlaySeat.tsx'
import { SidebarLauncher } from './SidebarLauncher.tsx'
import { offerMarketInstall, setMarketOpen } from './store.ts'
import { en, zh } from './locales.ts'

export const inject = ['slots', 'locale']

const NS = 'harness-market'

/**
 * The shell's preload exposes a receive-only deep-link channel. It is absent
 * when this UI runs outside the desktop shell (a plain browser against the
 * runtime), so every use is optional.
 */
interface ShellDeepLinkApi {
  deepLink?: { onInstallOffer(handler: (listingId: string) => void): () => void }
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'market-ui: copy dictionaries')
  const t = ctx.locale.bind(NS) as Translate

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'harness-market',
    inject: () => ({ t, onOpen: () => setMarketOpen(true) }),
  }, SidebarLauncher))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'harness-market',
    inject: () => ({ t }),
  }, OverlaySeat))

  // A `harness-ai://install?listing=…` link opens the market on that listing.
  // The link only names an id: the panel resolves it against the catalog and
  // the user still confirms, so a web page can never install anything by
  // itself.
  ctx.effect(() => {
    const shell = (globalThis as { harnessShell?: ShellDeepLinkApi }).harnessShell
    if (shell?.deepLink === undefined) return () => {}
    return shell.deepLink.onInstallOffer((listingId) => { offerMarketInstall(listingId) })
  }, 'market-ui: deep link install offers')
}
