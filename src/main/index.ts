import { join } from 'node:path'
import { BrowserWindow, app, dialog, shell } from 'electron'
import { resolveLocale, t } from '../shared/i18n'
import type { HarnessAdapter } from './harness/adapter'
import { createDshAdapter } from './harness/dsh'

let adapter: HarnessAdapter | undefined
let harnessBaseUrl: string | undefined
let quitting = false

function shellLocale(): ReturnType<typeof resolveLocale> {
  return resolveLocale(undefined, [app.getLocale()])
}

/** Origins the window may navigate to: the runtime UI and the dev placeholder server. */
function allowedOrigins(): string[] {
  const origins: string[] = []
  if (harnessBaseUrl !== undefined) origins.push(new URL(harnessBaseUrl).origin)
  if (process.env.ELECTRON_RENDERER_URL) origins.push(new URL(process.env.ELECTRON_RENDERER_URL).origin)
  return origins
}

function lockNavigation(win: BrowserWindow): void {
  // Same-origin navigation only; everything else opens in the system browser.
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:') || allowedOrigins().includes(new URL(url).origin)) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function loadPlaceholder(win: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  })
  win.once('ready-to-show', () => win.show())
  lockNavigation(win)
  if (harnessBaseUrl === undefined) {
    loadPlaceholder(win)
  } else {
    void win.loadURL(harnessBaseUrl)
  }
  return win
}

async function startHarness(win: BrowserWindow): Promise<void> {
  adapter = createDshAdapter({
    appRoot: app.getAppPath(),
    onExitRequest: (code) => {
      app.exit(code)
    },
  })
  try {
    const handle = await adapter.start()
    harnessBaseUrl = handle.baseUrl
    console.log(`${app.getName()}: harness runtime at ${handle.baseUrl}`)
    if (!win.isDestroyed()) await win.loadURL(handle.baseUrl)
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    console.error(`harness runtime failed to start: ${detail}`)
    if (!quitting) {
      dialog.showErrorBox(
        t(shellLocale(), 'shell.boot.failed.title'),
        `${t(shellLocale(), 'shell.boot.failed.detail')}\n\n${detail}`,
      )
    }
  }
}

app.whenReady().then(() => {
  const win = createWindow()
  void startHarness(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', (event) => {
  if (quitting) return
  quitting = true
  if (adapter === undefined) return
  // Hold the quit until the runtime tree is disposed (flushes session state).
  event.preventDefault()
  void adapter.stop()
    .catch((error: unknown) => {
      console.error(`harness runtime shutdown failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    .finally(() => app.exit(0))
})
