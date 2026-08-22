// The narrow seam between the Electron shell and the hosted agent runtime
// (workspace red line #3): the shell talks to this interface only, and every
// dsh-specific concept stays inside src/main/harness/.

/** A running harness runtime reachable over loopback. */
export interface HarnessHandle {
  /** Loopback origin serving the runtime's web UI, e.g. `http://127.0.0.1:43110`. */
  baseUrl: string
  port: number
}

export interface HarnessAdapter {
  /** Boot the runtime; resolves once its web endpoint is bound and the plugin tree settled. */
  start(): Promise<HarnessHandle>
  /** Dispose the runtime tree; safe to call more than once. */
  stop(): Promise<void>
}
