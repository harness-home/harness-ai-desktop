// Directory picker backed by Electron's dialog module.
//
// The upstream native backend spawns a helper process that drives an
// IFileOpenDialog through koffi. Inside the Electron shell that helper has no
// parent window: on Windows the chooser can open behind the app or never
// surface at all, and each attempt leaks another helper process — the user
// simply cannot pick a workspace. Electron's own dialog is modal to the shell
// window, needs no helper, and cancels cleanly.
import { BrowserWindow, dialog } from 'electron'
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'

export default class ElectronDirectoryPicker extends DirectoryPicker {
  private readonly nativeCapability: DirectoryPickerCapability = {
    kind: 'native',
    pick: async (signal: AbortSignal): Promise<string | null> => {
      if (signal.aborted) return null
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options = {
        title: 'Select a workspace folder',
        properties: ['openDirectory', 'createDirectory'] as const,
      }
      const result = parent === undefined
        ? await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
        : await dialog.showOpenDialog(parent, { ...options, properties: [...options.properties] })
      if (result.canceled || signal.aborted) return null
      return result.filePaths[0] ?? null
    },
  }

  /**
   * The native interaction capability (stable object for the service life).
   * @returns the Electron-backed `native` capability.
   */
  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }
}
