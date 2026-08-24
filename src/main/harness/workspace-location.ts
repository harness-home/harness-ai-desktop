// Workspace location admission.
//
// The agent runs shell commands inside the chosen workspace under upstream's
// Windows ACL pwsh sandbox, and the runtime lays down reparse points while
// resolving modules. Both assume real NTFS semantics. Pick a workspace on a
// network share or a FAT-formatted stick and nothing complains at pick time —
// it fails later, deep inside a tool call, as an error nobody can connect back
// to the folder they chose.
//
// So rather than infer capability from the drive type (which needs an FFI call
// into kernel32 and still only tells us the label on the box), we probe the two
// capabilities we actually depend on: can we write here, and does this volume
// support junctions. A probe answers for the directory in hand, including the
// cases a drive type would get wrong — a permissioned subtree on a fixed disk,
// or a virtual drive backed by something exotic.
//
// Dependency-free apart from node builtins, so the policy is unit testable
// without an Electron app (same reason as picker-overlay.ts).

import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** What is wrong with a candidate workspace, as a stable diagnostic token. */
export type WorkspaceConcern = 'network-share' | 'not-writable' | 'no-junction-support'

export type WorkspaceDecision =
  | { readonly verdict: 'allow' }
  /** Usable but degraded; the user decides. */
  | { readonly verdict: 'confirm', readonly concern: WorkspaceConcern }
  /** Known-broken; not offered as a choice. */
  | { readonly verdict: 'block', readonly concern: WorkspaceConcern }

/** The two capabilities the runtime depends on, injectable for tests. */
export interface WorkspaceProbe {
  /** Whether a file can be created inside this directory. */
  writable(directory: string): boolean
  /** Whether this volume accepts a directory junction. */
  junctions(directory: string): boolean
}

/**
 * Whether a Windows path lives on a network share.
 *
 * String-only and deterministic, so it decides before any probe touches the
 * disk — a dead share would otherwise hang the probe instead of failing it.
 *
 * @param path - candidate workspace path.
 * @returns true for UNC paths, including the `\\?\UNC\` extended form.
 */
export function isNetworkPath(path: string): boolean {
  const normalized = path.replace(/\//gu, '\\')
  if (normalized.toUpperCase().startsWith('\\\\?\\UNC\\')) return true
  // `\\?\` and `\\.\` are local device namespaces, not shares.
  if (normalized.startsWith('\\\\?\\') || normalized.startsWith('\\\\.\\')) return false
  return normalized.startsWith('\\\\')
}

/**
 * Decide whether a picked directory may become the workspace.
 *
 * @param platform - `process.platform` of the running shell.
 * @param path - directory the user picked.
 * @param probe - capability probe.
 * @returns the admission decision.
 */
export function evaluateWorkspaceLocation(
  platform: NodeJS.Platform,
  path: string,
  probe: WorkspaceProbe,
): WorkspaceDecision {
  // Windows-only for now: it is the platform we ship, and the ACL sandbox that
  // motivates this is a Windows code path. Adding macOS means probing what
  // *that* runtime needs, not reusing these answers.
  if (platform !== 'win32') return { verdict: 'allow' }
  if (isNetworkPath(path)) return { verdict: 'block', concern: 'network-share' }
  if (!probe.writable(path)) return { verdict: 'block', concern: 'not-writable' }
  // Degraded rather than fatal: plenty of work never lays down a reparse point,
  // and a false positive here would lock someone out of their own folder.
  if (!probe.junctions(path)) return { verdict: 'confirm', concern: 'no-junction-support' }
  return { verdict: 'allow' }
}

/**
 * Probe the real filesystem, leaving nothing behind.
 *
 * @returns a probe backed by a throwaway directory inside the candidate.
 */
export function nodeWorkspaceProbe(): WorkspaceProbe {
  const scratch = (directory: string, use: (dir: string) => void): boolean => {
    let temp: string | undefined
    try {
      temp = mkdtempSync(join(directory, '.harness-probe-'))
      use(temp)
      return true
    } catch {
      return false
    } finally {
      // force: the probe must never leave a dotdir in the user's workspace,
      // and a failed step may have created part of one.
      if (temp !== undefined) rmSync(temp, { recursive: true, force: true })
    }
  }
  return {
    writable: (directory) => scratch(directory, (dir) => {
      writeFileSync(join(dir, 'probe'), 'harness', 'utf8')
    }),
    junctions: (directory) => scratch(directory, (dir) => {
      const target = join(dir, 'target')
      mkdirSync(target)
      symlinkSync(target, join(dir, 'link'), 'junction')
    }),
  }
}
