// System tray (geo-desktop pattern): the app is tray-resident — closing the
// window hides it, the runtime keeps serving, and only the tray menu quits.
import { join } from 'node:path'
import { Menu, Tray, app, nativeImage } from 'electron'
import { resolveLocale, t, type Locale } from '../shared/i18n'

export interface TrayHost {
  /** Show and focus the main window (creating it when needed). */
  showWindow: () => void
  /** Quit for real (the tray-resident close handler checks this path). */
  quit: () => void
  /** Current signed-in email from local state, undefined when logged out. */
  accountEmail: () => string | undefined
}

let tray: Tray | undefined
let host: TrayHost | undefined

function locale(): Locale {
  return resolveLocale(undefined, [app.getLocale()])
}

function statusLabel(): string {
  const email = host?.accountEmail()
  return email === undefined ? t(locale(), 'tray.status.loggedOut') : `${t(locale(), 'tray.status.prefix')}${email}`
}

/** Rebuild the tooltip and context menu (call after login/logout). */
export function updateTray(): void {
  if (tray === undefined || host === undefined) return
  tray.setToolTip(`Harness AI — ${statusLabel()}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: statusLabel(), enabled: false },
    { type: 'separator' },
    { label: t(locale(), 'tray.open'), click: () => host?.showWindow() },
    { type: 'separator' },
    { label: t(locale(), 'tray.quit'), click: () => host?.quit() },
  ]))
}

export function createTray(trayHost: TrayHost): void {
  host = trayHost
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png'))
  tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }))
  tray.on('double-click', () => trayHost.showWindow())
  tray.on('click', () => trayHost.showWindow())
  updateTray()
}
