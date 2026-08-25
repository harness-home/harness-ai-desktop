// The two dialogs the update flow is allowed to show.
//
// Placement rules, which are the whole design:
// - The only unprompted interruption is "a new version is downloaded and ready",
//   because that is the only moment where there is something to act on. Finding
//   an update and downloading it happen in the tray, silently.
// - A check the user asked for always answers, including "you are up to date".
//   Silence would read as a broken button.
// - Dialogs are modal to the main window when there is one, and free-floating
//   when the window is hidden (the app is tray-resident, so that is a normal
//   state, not an error).
// - Nothing here decides anything. It asks, and hands the answer back.
import { BrowserWindow, dialog } from 'electron'
import { resolveLocale, t, type Locale } from '../shared/i18n'
import { log } from './log'
import type { InstallAnswer, UpdateStatus } from './updater'

export interface UpdatePromptHost {
  /** The window to be modal to, when one is visible. */
  window: () => BrowserWindow | undefined
  /** Locale for dialog text, resolved the same way the tray resolves it. */
  locale: () => Locale
  /** Carry the user's answer back to the updater. */
  answer: (answer: InstallAnswer) => void
}

/**
 * Show a message box, tolerating the app having no window. Returns the index of
 * the button the user pressed.
 */
async function show(
  host: UpdatePromptHost,
  options: Electron.MessageBoxOptions,
): Promise<number> {
  const window = host.window()
  const result = window !== undefined && !window.isDestroyed()
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response
}

/** The three answers, in the order they appear as buttons. */
const ANSWERS: readonly InstallAnswer[] = ['now', 'later', 'cancel']

/**
 * Map the pressed button back to an answer.
 *
 * Anything that is not a button press — the dialog closed, dismissed, or
 * reporting an index this code does not know — reads as `cancel`, because the
 * only answer that is safe to assume from silence is the one that does not
 * restart the user's app for them.
 *
 * Pure and exported so the mapping is pinned by tests: it is the one link
 * between a native dialog and what the updater then does, and a native dialog
 * is the part an automated run cannot press.
 */
export function answerForButton(response: number): InstallAnswer {
  return ANSWERS[response] ?? 'cancel'
}

/**
 * Offer a staged update: install now, defer it, or cancel it.
 *
 * Deferring and cancelling are genuinely different and the dialog has to say
 * which is which, because the update is already downloaded. Deferring lets it
 * install at the next quit, which is what happens if nobody does anything;
 * cancelling stops that, and is the only answer that changes the app's
 * behaviour. Closing the dialog counts as cancelling — the safe reading of "the
 * user did not answer" is "do not restart them unasked".
 */
export function offerInstall(host: UpdatePromptHost, version: string): void {
  const locale = host.locale()
  void show(host, {
    type: 'info',
    buttons: [
      t(locale, 'update.ready.restart'),
      t(locale, 'update.ready.later'),
      t(locale, 'update.ready.cancel'),
    ],
    defaultId: 0,
    cancelId: 2,
    title: t(locale, 'update.ready.title'),
    message: t(locale, 'update.ready.message', { version }),
    detail: t(locale, 'update.ready.detail'),
  }).then((response) => {
    const answer = answerForButton(response)
    log.info(`updater: user answered '${answer}' for ${version}`)
    host.answer(answer)
  }).catch((error: unknown) => {
    // A dialog that cannot open must not take the update path down with it.
    log.warn(`updater: could not show the install prompt (${error instanceof Error ? error.message : String(error)})`)
  })
}

/** Answer a check the user asked for. */
export function reportCheck(host: UpdatePromptHost, status: UpdateStatus): void {
  const locale = host.locale()
  const version = status.availableVersion ?? ''
  const options: Electron.MessageBoxOptions = (() => {
    switch (status.phase) {
      case 'available':
      case 'downloading':
        return {
          type: 'info' as const,
          message: t(locale, 'update.found.message', { version }),
          detail: t(locale, 'update.found.detail'),
        }
      case 'ready':
        return {
          type: 'info' as const,
          message: t(locale, 'update.ready.message', { version }),
          detail: t(locale, 'update.ready.detail'),
        }
      case 'error':
        return {
          type: 'warning' as const,
          message: t(locale, 'update.failed.message'),
          detail: status.message ?? '',
        }
      case 'unsupported':
        return {
          type: 'info' as const,
          message: t(locale, status.reason === 'no-feed'
            ? 'update.unsupported.noFeed'
            : 'update.unsupported.notPackaged'),
          detail: '',
        }
      default:
        return {
          type: 'info' as const,
          message: t(locale, 'update.upToDate.message', { version: status.currentVersion }),
          detail: '',
        }
    }
  })()

  void show(host, {
    buttons: [t(locale, 'update.ok')],
    defaultId: 0,
    title: t(locale, 'update.check.title'),
    ...options,
  }).catch((error: unknown) => {
    log.warn(`updater: could not show the check result (${error instanceof Error ? error.message : String(error)})`)
  })
}

/** Resolve the dialog locale the way the tray does: system tags, fixed fallback. */
export function dialogLocale(systemTags: readonly string[]): Locale {
  return resolveLocale(undefined, systemTags)
}
