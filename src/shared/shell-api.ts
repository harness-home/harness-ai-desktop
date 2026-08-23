/** Recovery actions the failure surface can request from the main process. */
export type RecoveryAction = 'retry' | 'open-logs' | 'quit'

/** The preload-exposed shell API, as seen from renderer pages. */
export interface HarnessShellApi {
  recovery: {
    retry(): void
    openLogs(): void
    quit(): void
  }
  /**
   * Deep-link delivery, main process to renderer only. The page can subscribe
   * to install offers; it cannot send anything back through this channel, and
   * the id it receives still has to be resolved and confirmed like any other.
   */
  deepLink: {
    onInstallOffer(handler: (listingId: string) => void): () => void
  }
}

declare global {
  interface Window {
    /** Exposed by the shell's preload on every page it loads. */
    harnessShell?: HarnessShellApi
  }
}
