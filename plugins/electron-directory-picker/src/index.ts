// Directory picker backed by Electron's own native dialog.
//
// Why swap at all: upstream's native backend spawns a helper process that
// drives an IFileOpenDialog through koffi. Inside the Electron shell that
// helper has no parent window: on Windows the chooser can open behind the app
// or never surface at all, and each attempt leaks another helper process — the
// user simply cannot pick a workspace. Electron's own dialog is modal to the
// shell window, needs no helper, and cancels cleanly.
//
// It also owns admission: a folder the runtime cannot actually work in is
// refused here, at the moment the user picks it, rather than failing later
// inside a tool call. See src/main/harness/workspace-location.ts.
import { BrowserWindow, app, dialog } from 'electron'
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'
import {
  evaluateWorkspaceLocation,
  nodeWorkspaceProbe,
} from '../../../src/main/harness/workspace-location'
import { en, zh, type PickerCopy } from './locales'

/** System language, falling back to en-US per the workspace language rule (ledger #11). */
function copy(): PickerCopy {
  return app.getLocale().toLowerCase().startsWith('zh') ? zh : en
}

export default class ElectronDirectoryPicker extends DirectoryPicker {
  private readonly nativeCapability: DirectoryPickerCapability = {
    kind: 'native',
    pick: async (signal: AbortSignal): Promise<string | null> => {
      if (signal.aborted) return null
      const t = copy()
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options = {
        title: t.pickTitle,
        properties: ['openDirectory', 'createDirectory'] as const,
      }
      const result = parent === undefined
        ? await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
        : await dialog.showOpenDialog(parent, { ...options, properties: [...options.properties] })
      if (result.canceled || signal.aborted) return null
      const picked = result.filePaths[0] ?? null
      if (picked === null) return null
      return await this.admit(picked, t, parent)
    },
  }

  /**
   * Apply the workspace admission policy to a picked folder.
   *
   * @param picked - directory the user chose.
   * @param t - dialog copy in the active language.
   * @param parent - window the dialog should be modal to.
   * @returns the folder, or null when it is refused or the user backs out.
   */
  private async admit(
    picked: string,
    t: PickerCopy,
    parent: BrowserWindow | undefined,
  ): Promise<string | null> {
    const decision = evaluateWorkspaceLocation(process.platform, picked, nodeWorkspaceProbe())
    if (decision.verdict === 'allow') return picked
    const blocked = decision.verdict === 'block'
    const box = {
      'network-share': { title: t.networkTitle, message: t.networkMessage, detail: t.networkDetail },
      'not-writable': { title: t.readOnlyTitle, message: t.readOnlyMessage, detail: t.readOnlyDetail },
      'no-junction-support': { title: t.junctionTitle, message: t.junctionMessage, detail: t.junctionDetail },
    }[decision.concern]
    const options = {
      type: blocked ? ('error' as const) : ('warning' as const),
      title: box.title,
      message: box.message,
      detail: `${box.detail}\n\n${picked}`,
      // Refusals get one way out; a degraded folder is the user's call, and
      // "choose another" is the default so nobody opts in by reflex.
      buttons: blocked ? [t.chooseAnother] : [t.useAnyway, t.chooseAnother],
      defaultId: blocked ? 0 : 1,
      cancelId: blocked ? 0 : 1,
      noLink: true,
    }
    const answer = parent === undefined
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(parent, options)
    return !blocked && answer.response === 0 ? picked : null
  }

  /**
   * The native interaction capability (stable object for the service life).
   * @returns the Electron-backed `native` capability.
   */
  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }
}
