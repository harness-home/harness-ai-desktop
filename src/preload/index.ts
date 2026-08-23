import { contextBridge, ipcRenderer } from 'electron'

// The API surface the shell exposes to the pages it loads. `recovery` is only
// acted on for the shell's own pages (the main process checks the sender);
// `deepLink` is receive-only and carries no privilege — it hands the runtime UI
// a catalog id that the market panel still has to resolve and confirm.
contextBridge.exposeInMainWorld('harnessShell', {
  recovery: {
    retry: (): void => ipcRenderer.send('shell:recovery', 'retry'),
    openLogs: (): void => ipcRenderer.send('shell:recovery', 'open-logs'),
    quit: (): void => ipcRenderer.send('shell:recovery', 'quit'),
  },
  deepLink: {
    onInstallOffer: (handler: (listingId: string) => void): (() => void) => {
      const listener = (_event: unknown, listingId: unknown): void => {
        if (typeof listingId === 'string') handler(listingId)
      }
      ipcRenderer.on('shell:market-install', listener)
      return () => { ipcRenderer.off('shell:market-install', listener) }
    },
  },
})
