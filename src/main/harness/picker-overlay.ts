// Directory-picker swap, kept as its own dependency-free module so the pairing
// rule below can be unit tested without booting a runtime.
//
// Why swap at all: upstream's native backend spawns a parentless helper process
// that drives an IFileOpenDialog. Inside the Electron shell that helper has no
// parent window — on Windows the chooser opens behind the app or never surfaces
// at all, and every attempt leaks another helper. Our backend uses Electron's
// own dialog, modal to the shell window.

/** Our Electron-dialog host backend for the `directoryPicker` seam. */
export const PICKER_BACKEND = '@harness-ai/desktop-directory-picker'

/**
 * Client surface for the native picking interaction.
 *
 * Upstream's adaptive chooser row (`dsh-host-directory-picker-auto`) mounts a
 * *pair*: a host backend plus this client plugin, which is the thing that fills
 * ui-workspace's `conversation.hero.workspace.directoryFlow` and
 * `sidebar.workspaces.directoryFlow` holes. Disabling that row and inserting
 * only a backend leaves both holes empty, and then the workspace chip opens a
 * menu with nothing in it — the user cannot pick a workspace at all. That
 * shipped in 0.1.0 through 0.1.2. Anything that swaps the backend must compose
 * both faces.
 */
export const PICKER_CLIENT_SURFACE = '@deepseek-ai/dsh-client-ui-directory-picker-native'

/**
 * Overlay rows replacing the composed `directory-picker` row with our own
 * interaction, both faces included.
 *
 * @param rowName - package the `directory-picker` row currently names.
 * @returns the disable row followed by the insert row.
 */
export function directoryPickerOverlays(rowName: string): object[] {
  return [
    { id: 'directory-picker', name: rowName, disabled: true },
    {
      insert: [
        { id: 'desktop-directory-picker', name: PICKER_BACKEND },
        { id: 'desktop-directory-picker-surface', name: PICKER_CLIENT_SURFACE },
      ],
    },
  ]
}
