// Product chrome CSS injected into the embedded UI. The shell owns a few
// layout facts that no single plugin can fix on its own — notably the shared
// sidebar footer-action row, which the shipped layout renders as ONE row of
// icons. With two shell entries (Account, Market) that row squeezes them into
// the 56px rail: the buttons overflow the column and stop being clickable.
// Stacking them full-width matches the Settings row directly below.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Marker class every shell-owned sidebar entry carries. */
export const SIDEBAR_ACTION_CLASS = 'harness-sidebar-action'

const CHROME_CSS = `
/* Stack the shell's sidebar footer actions instead of packing them in a row. */
div:has(> * > .${SIDEBAR_ACTION_CLASS}) {
  flex-direction: column !important;
  align-items: stretch !important;
  gap: 2px !important;
  width: 100% !important;
}
.${SIDEBAR_ACTION_CLASS} {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13px;
  line-height: 1.2;
  cursor: pointer;
  text-align: left;
}
.${SIDEBAR_ACTION_CLASS}:hover {
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #808080) 8%, transparent);
}
.${SIDEBAR_ACTION_CLASS} > svg { flex: none; }
.${SIDEBAR_ACTION_CLASS}[data-rail="true"] { justify-content: center; padding: 7px 0; }
`

/** Inject the chrome stylesheet into the served index page. */
export function registerChromeCss(ctx: Context): void {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.tapIndex((html) =>
        html.replace('</head>', `<style data-harness-chrome>${CHROME_CSS}</style></head>`)),
      'chrome css',
    )
  })
}
