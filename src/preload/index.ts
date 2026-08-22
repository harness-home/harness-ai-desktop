import { contextBridge, ipcRenderer } from 'electron'

// The single API surface the shell exposes to its own pages (the placeholder
// and failure surfaces). The embedded runtime UI never needs it.
contextBridge.exposeInMainWorld('harnessShell', {
  recovery: {
    retry: (): void => ipcRenderer.send('shell:recovery', 'retry'),
    openLogs: (): void => ipcRenderer.send('shell:recovery', 'open-logs'),
    quit: (): void => ipcRenderer.send('shell:recovery', 'quit'),
  },
})
