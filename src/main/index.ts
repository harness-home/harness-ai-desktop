import { createRequire } from 'node:module'
import { join } from 'node:path'
import { BrowserWindow, Menu, app, ipcMain, shell } from 'electron'
import type { RecoveryAction } from '../shared/shell-api'
import { DesktopAccountService } from './account/service'
import type { HarnessAdapter } from './harness/adapter'
import { createDshAdapter } from './harness/dsh'
import { startHostingBridge } from './harness/hosting'
import { installNodeSpawnShim } from './harness/node-spawn-shim'
import { initFileLog, log, logFilePath } from './log'
import { maskSecrets } from './mask-secrets'
import { createTray, updateTray } from './tray'

/** Startup health gate: native mount + renderer load must finish inside this window. */
const BOOT_TIMEOUT_MS = 30_000

let adapter: HarnessAdapter | undefined
let accountService: DesktopAccountService | undefined
let hostingBridge: { stop: () => void } | undefined

const nodeRequire = createRequire(import.meta.url)

/** Runtime dsh version, stamped into hosted-session heads as the format discriminator. */
function dshVersion(): string {
  try {
    return (nodeRequire('@deepseek-ai/dsh/package.json') as { version: string }).version
  } catch {
    return 'unknown'
  }
}
let mainWindow: BrowserWindow | undefined
let harnessBaseUrl: string | undefined
let bootState: 'starting' | 'ready' | 'failed' = 'starting'
let quitting = false

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

/** Load the shell's own page (placeholder or failure surface) with state query params. */
function loadShellPage(win: BrowserWindow, query: Record<string, string>): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    void win.loadURL(url.href)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), { query })
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Harness AI',
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    show: false,
    // Windows/Linux draw a per-window menu bar even with no application menu.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  })
  win.once('ready-to-show', () => win.show())
  // The embedded UI's document title is upstream's build-time constant; the
  // window keeps the product name instead.
  win.on('page-title-updated', (event) => event.preventDefault())
  // Tray-resident: closing the window hides it while the runtime keeps
  // serving; only the tray menu (or the recovery page) quits for real.
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
  })
  lockNavigation(win)
  if (bootState === 'ready' && harnessBaseUrl !== undefined) {
    void win.loadURL(harnessBaseUrl)
  } else {
    loadShellPage(win, { state: 'starting' })
  }
  mainWindow = win
  return win
}

function showMainWindow(): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) createWindow()
  else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

function showFailure(win: BrowserWindow, detail: string): void {
  bootState = 'failed'
  if (win.isDestroyed()) return
  // The failure surface must render even when the runtime is down: it is the
  // local placeholder page with recovery actions, never a remote URL.
  loadShellPage(win, { state: 'failed', detail: maskSecrets(detail).slice(0, 2000) })
}

async function startHarness(win: BrowserWindow): Promise<void> {
  installNodeSpawnShim()
  adapter = createDshAdapter({
    appRoot: app.getAppPath(),
    onExitRequest: (code) => {
      app.exit(code)
    },
    accountService,
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    log.error(`startup health gate timed out after ${String(BOOT_TIMEOUT_MS)}ms`)
    showFailure(win, `The runtime did not become healthy within ${String(BOOT_TIMEOUT_MS / 1000)}s.`)
  }, BOOT_TIMEOUT_MS)
  try {
    // Gate 1: native mount — the plugin tree settled and the web server bound.
    const handle = await adapter.start()
    harnessBaseUrl = handle.baseUrl
    log.info(`harness runtime at ${handle.baseUrl}`)
    if (accountService !== undefined) {
      hostingBridge = startHostingBridge({
        localBaseUrl: handle.baseUrl,
        account: accountService,
        harnessFormatVersion: dshVersion(),
        dropChunks: process.env.HARNESS_SYNC_DROP_CHUNKS === '1',
      })
    }
    if (timedOut || win.isDestroyed()) return
    // Gate 2: renderer report — loadURL resolves on did-finish-load and
    // rejects on did-fail-load, so an unreachable or crashing page fails loud.
    await win.loadURL(handle.baseUrl)
    if (timedOut) return
    bootState = 'ready'
    log.info('startup health gate passed')
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    log.error(`harness startup failed: ${detail}`)
    if (!timedOut && !quitting) showFailure(win, detail)
  } finally {
    clearTimeout(timeout)
  }
}

function handleRecovery(action: RecoveryAction): void {
  switch (action) {
    case 'retry':
      log.info('recovery: relaunch requested')
      app.relaunch()
      app.exit(0)
      break
    case 'open-logs':
      shell.showItemInFolder(logFilePath())
      break
    case 'quit':
      app.quit()
      break
  }
}

const locked = app.requestSingleInstanceLock()
if (!locked) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  ipcMain.on('shell:recovery', (event, action: unknown) => {
    // Recovery is exposed only to the shell's own pages, never the runtime UI.
    const senderUrl = event.senderFrame?.url ?? ''
    const fromShellPage = senderUrl.startsWith('file:')
      || (process.env.ELECTRON_RENDERER_URL !== undefined && senderUrl.startsWith(process.env.ELECTRON_RENDERER_URL))
    if (!fromShellPage) return
    if (action === 'retry' || action === 'open-logs' || action === 'quit') handleRecovery(action)
  })

  // No application menu: the product chrome is the embedded UI plus the tray,
  // and the default Electron menu would also expose reload/devtools shortcuts
  // over the runtime surface. Must run before the first window is created.
  Menu.setApplicationMenu(null)

  app.whenReady().then(() => {
    initFileLog()
    log.info(`shell starting (v${app.getVersion()}, electron ${process.versions.electron})`)
    // Deployment endpoint is still open (ledger #25); default to the local
    // dev server until one exists.
    accountService = new DesktopAccountService({
      serverUrl: process.env.HARNESS_SERVER_URL ?? 'http://localhost:8720',
      storageFile: join(app.getPath('userData'), 'account.json'),
      appVersion: app.getVersion(),
      onChanged: () => updateTray(),
    })
    const win = createWindow()
    void startHarness(win)
    createTray({
      showWindow: showMainWindow,
      quit: () => app.quit(),
      accountEmail: () => accountService?.snapshot().email,
    })

    app.on('activate', () => {
      showMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Tray-resident: keep the runtime alive with every window closed.
  })

  // Runs before window close events, so the close-to-tray handler lets the
  // windows actually close on a real quit.
  app.on('before-quit', () => {
    quitting = true
  })

  let disposed = false
  app.on('will-quit', (event) => {
    if (disposed) return
    disposed = true
    hostingBridge?.stop()
    if (adapter === undefined) return
    // Hold the quit until the runtime tree is disposed (flushes session state).
    event.preventDefault()
    void adapter.stop()
      .catch((error: unknown) => {
        log.error(`harness shutdown failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => app.exit(0))
  })

  process.on('uncaughtException', (error) => {
    log.error(`uncaught exception: ${error.stack ?? error.message}`)
  })
  process.on('unhandledRejection', (reason) => {
    log.error(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
  })
}
