// Harness AI occupants for the web client's brand slots, plus the Harness
// theme pair. The official brand occupants sit at priority 0 and the lowest
// priority renders, so ours shadow them from -1.
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { BrandMark, BrandName } from './Brand.tsx'

export const inject = ['slots', 'theme']

const BRAND_PRIMARY_LIGHT = '#0f766e'
const BRAND_PRIMARY_DARK = '#2dd4bf'

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, BrandMark), 'brand: sidebar mark')
  ctx.effect(() => ctx.slots.register({ name: 'sidebar.brand.name', priority: -1 }, BrandName), 'brand: sidebar name')
  ctx.effect(() => ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -1 }, BrandMark), 'brand: hero mark')
  ctx.effect(() => ctx.theme.register({
    id: 'harness-light',
    colorScheme: 'light',
    tokens: { '--dsw-alias-brand-primary': BRAND_PRIMARY_LIGHT },
  }), 'brand: light theme')
  ctx.effect(() => ctx.theme.register({
    id: 'harness-dark',
    colorScheme: 'dark',
    tokens: { '--dsw-alias-brand-primary': BRAND_PRIMARY_DARK },
  }), 'brand: dark theme')
}
