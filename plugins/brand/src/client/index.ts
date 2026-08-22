// Harness AI occupants for the web client's brand slots, plus the Harness
// theme pair. The official brand occupants sit at priority 0 and the lowest
// priority renders, so ours shadow them from -1.
import * as React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'

export const inject = ['slots', 'theme']

const BRAND_NAME = 'Harness AI'
const BRAND_PRIMARY_LIGHT = '#0f766e'
const BRAND_PRIMARY_DARK = '#2dd4bf'

function BrandMark(): React.ReactElement {
  return React.createElement(
    'svg',
    { viewBox: '0 0 32 32', width: '1.5em', height: '1.5em', 'aria-label': BRAND_NAME, role: 'img' },
    React.createElement('rect', { x: 2, y: 2, width: 28, height: 28, rx: 7, fill: 'currentColor', opacity: 0.15 }),
    // A stylized "H" of two pillars and a crossbar.
    React.createElement('rect', { x: 8, y: 8, width: 4, height: 16, rx: 2, fill: 'currentColor' }),
    React.createElement('rect', { x: 20, y: 8, width: 4, height: 16, rx: 2, fill: 'currentColor' }),
    React.createElement('rect', { x: 10, y: 14, width: 12, height: 4, rx: 2, fill: 'currentColor' }),
  )
}

function BrandName(): React.ReactElement {
  return React.createElement('span', null, BRAND_NAME)
}

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
