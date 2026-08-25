import { createRequire } from 'node:module'
import { join } from 'node:path'
import { BrowserWindow, Menu, app, ipcMain, shell } from 'electron'
import type { RecoveryAction } from '../shared/shell-api'
import { DesktopAccountService } from './account/service'
import { auditPreviousRun, markCleanExit, startCrashReporting } from './crash'
import { deepLinkFromArgv, parseDeepLink, registerProtocolClient, type DeepLinkRequest } from './deep-link'
import type { HarnessAdapter } from './harness/adapter'
import { createDshAdapter } from './harness/dsh'
import { startHostingBridge } from './harness/hosting'
import { installNodeSpawnShim } from './harness/node-spawn-shim'
import { initFileLog, log, logFilePath } from './log'
import { createBootWatchdog } from './boot-watchdog'
import { maskSecrets } from './mask-secrets'
import { pluginRegistry } from './runtime-config'
import { currentStage, enterStage, setStageLogger, startupTimeline } from './startup-stage'
import { createTray, updateTray } from './tray'
import { answerInstall, disposeUpdater, initUpdater } from './updater'
import { dialogLocale, offerInstall, reportCheck, type UpdatePromptHost } from './update-prompt'


/** Health gate for the boot in flight; stage transitions tick it too. */
let bootGate: { progress: (label?: string) => void } | undefined
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
/** Deep link that arrived before the runtime UI could receive it. */
let pendingDeepLink: DeepLinkRequest | undefined
let mainWindow: BrowserWindow | undefined
let harnessBaseUrl: string | undefined
let bootState: 'starting' | 'ready' | 'failed' = 'starting'
let quitting = false

/**
 * Leave through a known door. `app.exit()` bypasses `will-quit`, so the run
 * marker has to be cleared here rather than in a teardown hook.
 */
function exitApp(code: number): void {
  markCleanExit()
  app.exit(code)
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

/**
 * Hand a deep link to the runtime UI. The market panel decides what to show and
 * still asks the user to confirm; the main process never installs on its own.
 * Requests that arrive before the UI is up are queued and flushed on boot.
 */
function deliverDeepLink(request: DeepLinkRequest): void {
  if (request.kind === 'open') return
  if (bootState !== 'ready' || mainWindow === undefined || mainWindow.isDestroyed()) {
    pendingDeepLink = request
    return
  }
  pendingDeepLink = undefined
  log.info(`deep link: offering install of listing ${request.listingId}`)
  mainWindow.webContents.send('shell:market-install', request.listingId)
}

/** Parse one incoming deep-link URL, focus the window, and route the request. */
function handleDeepLink(raw: string | undefined): void {
  if (raw === undefined) return
  const request = parseDeepLink(raw)
  if (request === null) {
    log.warn('deep link: ignored an unrecognized url')
    return
  }
  showMainWindow()
  deliverDeepLink(request)
}

function showFailure(win: BrowserWindow, detail: string): void {
  bootState = 'failed'
  // The stage narrows the search before anyone opens the log, and the timeline
  // says whether a stage hung or failed outright.
  const stage = currentStage() ?? 'unknown'
  log.error(`startup failed at stage ${stage}; timeline: ${startupTimeline()}`)
  if (win.isDestroyed()) return
  // The failure surface must render even when the runtime is down: it is the
  // local placeholder page with recovery actions, never a remote URL.
  loadShellPage(win, { state: 'failed', stage, detail: maskSecrets(detail).slice(0, 2000) })
}

async function startHarness(win: BrowserWindow): Promise<void> {
  installNodeSpawnShim()
  // The gate watches for a lack of progress rather than for elapsed time; see
  // boot-watchdog.ts for why a flat budget could not be set correctly.
  const gate = createBootWatchdog({
    onTimeout: (reason) => {
      log.error(`startup health gate tripped: ${reason}`)
      showFailure(win, `The runtime did not become healthy: ${reason}.`)
    },
  })
  adapter = createDshAdapter({
    appRoot: app.getAppPath(),
    onExitRequest: (code) => {
      exitApp(code)
    },
    accountService,
    requestRestart: () => {
      log.info('restart requested (market profile change)')
      app.relaunch()
      exitApp(0)
    },
    onProgress: (label) => gate.progress(label),
  })
  bootGate = gate
  try {
    // Gate 1: native mount — the plugin tree settled and the web server bound.
    const handle = await adapter.start()
    harnessBaseUrl = handle.baseUrl
    log.info(`harness runtime at ${handle.baseUrl}`)
    if (accountService !== undefined) {
      enterStage('hosting-bridge')
      hostingBridge = startHostingBridge({
        localBaseUrl: handle.baseUrl,
        account: accountService,
        harnessFormatVersion: dshVersion(),
        dropChunks: process.env.HARNESS_SYNC_DROP_CHUNKS === '1',
      })
    }
    if (gate.tripped() || win.isDestroyed()) return
    enterStage('renderer-load')
    // Gate 2: renderer report — loadURL resolves on did-finish-load and
    // rejects on did-fail-load, so an unreachable or crashing page fails loud.
    await win.loadURL(handle.baseUrl)
    if (gate.tripped()) return
    enterStage('ready')
    bootState = 'ready'
    log.info(`startup health gate passed; timeline: ${startupTimeline()}`)
    if (pendingDeepLink !== undefined) deliverDeepLink(pendingDeepLink)
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    log.error(`harness startup failed: ${detail}`)
    if (!gate.tripped() && !quitting) showFailure(win, detail)
  } finally {
    gate.stop()
    bootGate = undefined
  }
}

function handleRecovery(action: RecoveryAction): void {
  switch (action) {
    case 'retry':
      log.info('recovery: relaunch requested')
      app.relaunch()
      exitApp(0)
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
  // Windows and Linux deliver a deep link as an argument to the second launch.
  app.on('second-instance', (_event, argv) => {
    showMainWindow()
    handleDeepLink(deepLinkFromArgv(argv))
  })

  // macOS delivers it as an event instead, possibly before the app is ready.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
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

  // Before ready on purpose: a crash during runtime mount is exactly the kind
  // we cannot otherwise see.
  startCrashReporting(dshVersion())

  app.whenReady().then(() => {
    initFileLog()
    // A stage change is progress too — and the only progress signal during
    // profile-audit, which has no runtime fibers to report yet.
    setStageLogger((line) => {
      log.info(line)
      bootGate?.progress(currentStage())
    })
    enterStage('app-ready')
    log.info(`shell starting (v${app.getVersion()}, electron ${process.versions.electron})`)
    // Resolve the installation's config here rather than at first use, so every
    // run states what it read. A support report starts from this line, and a
    // client that never opened the market would otherwise never print it.
    pluginRegistry()
    auditPreviousRun(dshVersion())
    // Deployment endpoint is still open (ledger #25); default to the local
    // dev server until one exists.
    accountService = new DesktopAccountService({
      serverUrl: process.env.HARNESS_SERVER_URL ?? 'http://localhost:8720',
      storageFile: join(app.getPath('userData'), 'account.json'),
      appVersion: app.getVersion(),
      onChanged: () => updateTray(),
    })
    if (registerProtocolClient()) log.info('registered the harness-ai:// protocol client')
    else log.warn('could not register the harness-ai:// protocol client')
    enterStage('window-create')
    const win = createWindow()
    void startHarness(win)
    // A cold start from a link carries it in this process's own arguments.
    handleDeepLink(deepLinkFromArgv(process.argv))
    createTray({
      showWindow: showMainWindow,
      quit: () => app.quit(),
      accountEmail: () => accountService?.snapshot().email,
    })
    // Updates are a shell concern, independent of the runtime: a client whose
    // runtime will not start must still be able to update itself out of it.
    // The updater owns update state; the shell owns the window, so the two
    // dialogs it is allowed to show are wired in from here.
    const promptHost: UpdatePromptHost = {
      window: () => (mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined),
      locale: () => dialogLocale([app.getLocale()]),
      answer: (answer) => { answerInstall(answer) },
    }
    initUpdater({
      onChanged: () => updateTray(),
      offerInstall: (version) => { offerInstall(promptHost, version) },
      reportCheck: (status) => { reportCheck(promptHost, status) },
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
    markCleanExit()
  })

  let disposed = false
  app.on('will-quit', (event) => {
    if (disposed) return
    disposed = true
    disposeUpdater()
    hostingBridge?.stop()
    if (adapter === undefined) return
    // Hold the quit until the runtime tree is disposed (flushes session state).
    event.preventDefault()
    void adapter.stop()
      .catch((error: unknown) => {
        log.error(`harness shutdown failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => exitApp(0))
  })

  process.on('uncaughtException', (error) => {
    log.error(`uncaught exception: ${error.stack ?? error.message}`)
  })
  process.on('unhandledRejection', (reason) => {
    log.error(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
  })
}
