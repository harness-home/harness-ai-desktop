// Native window chrome follows the embedded UI's theme.
//
// The window keeps the platform frame, and on Windows and Linux that frame is
// painted from the *application's* theme, which Electron takes from
// `nativeTheme` — by default the OS scheme. The theme the user actually sees is
// the embedded UI's: the Appearance row writes `ui-theme.preference` into the
// Host user-settings document. Left alone the two disagree — picking Light on a
// dark-mode desktop leaves a black caption bar over a white app.
//
// So the shell mirrors that one preference onto `nativeTheme.themeSource`,
// whose values are the same three. `system` is passed through rather than
// resolved: forcing the resolved scheme would pin `prefers-color-scheme` in the
// renderer, and the UI resolves `system` through that very query — it would
// stop following the OS the first time the OS flipped.
import { nativeTheme } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import { DEFAULT_PREFERENCE, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-client-ui-theme'
import { log } from '../log'

/** The theme plugin's settings namespace, branded for the settings service. */
const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE)

/** The built-in preferences, which are also the `themeSource` values. */
type ThemePreference = (typeof THEME_PREFERENCES)[number]

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
}

/** The stored preference, or the schema default when the section is absent or unreadable. */
function readPreference(ctx: Context): ThemePreference {
  const section = ctx.settings.get(THEME_NAMESPACE)
  if (typeof section !== 'object' || section === null) return DEFAULT_PREFERENCE
  const preference = (section as { preference?: unknown }).preference
  return isPreference(preference) ? preference : DEFAULT_PREFERENCE
}

function follow(preference: ThemePreference): void {
  if (nativeTheme.themeSource === preference) return
  nativeTheme.themeSource = preference
  log.info(`window theme: native frame follows the ui theme preference (${preference})`)
}

/**
 * Keep the native window chrome on the embedded UI's theme preference.
 *
 * Call this with the settled root context, not from the boot callback: the
 * settings service becomes injectable before the theme plugin registers its
 * namespace, and reading it any earlier answers `undefined` — the default —
 * for a preference that is already stored.
 *
 * @param ctx - the runtime's root context, after the tree has mounted.
 */
export function registerWindowTheme(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    follow(readPreference(settingsCtx))
    // Both sources matter: `update` is the user switching in the Appearance
    // row, `provider` is settings.yaml being edited or reloaded underneath us.
    settingsCtx.on('settings/updated', (ns, next) => {
      if (ns !== THEME_NAMESPACE) return
      const preference = (next as { preference?: unknown } | undefined)?.preference
      follow(isPreference(preference) ? preference : DEFAULT_PREFERENCE)
    })
  })
}
