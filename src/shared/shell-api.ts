/** Recovery actions the failure surface can request from the main process. */
export type RecoveryAction = 'retry' | 'open-logs' | 'quit'

/** The preload-exposed shell API, as seen from renderer pages. */
export interface HarnessShellApi {
  recovery: {
    retry(): void
    openLogs(): void
    quit(): void
  }
}

declare global {
  interface Window {
    /** Present only on the shell's own pages (placeholder / failure surface). */
    harnessShell?: HarnessShellApi
  }
}
