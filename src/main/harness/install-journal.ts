import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../log'

// Write-ahead journal for profile installs.
//
// An install mutates two things that must agree: the profile's dependency list
// and its registered bundle layers. A crash, a kill, or a power cut between
// them leaves a profile that names a bundle it cannot load — and a profile that
// cannot load is a client that will not start (the 0.1.0 accident this codebase
// already paid for once).
//
// So the manifest's exact prior bytes are journaled before the first write and
// restored if the operation never reports completion. Restoring text rather
// than replaying edits keeps recovery total: whatever the install did to the
// manifest, undoing it is one file write with no parsing involved.

const JOURNAL_FILE = 'harness-install-journal.json'

export interface InstallJournalEntry {
  operation: 'install' | 'uninstall'
  packageName: string
  version: string | null
  startedAt: string
  /** Verbatim contents of the profile manifest before the operation began. */
  priorManifest: string
}

function journalPath(profileDir: string): string {
  return join(profileDir, JOURNAL_FILE)
}

/** Record the pre-operation state. Returns false when it cannot be journaled. */
export function beginOperation(
  profileDir: string,
  operation: InstallJournalEntry['operation'],
  packageName: string,
  version: string | null,
  now: () => Date = () => new Date(),
): boolean {
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) return false
  try {
    const entry: InstallJournalEntry = {
      operation,
      packageName,
      version,
      startedAt: now().toISOString(),
      priorManifest: readFileSync(manifestPath, 'utf8'),
    }
    writeFileSync(journalPath(profileDir), JSON.stringify(entry, undefined, 2) + '\n')
    return true
  } catch (error) {
    log.warn(`market: could not journal the ${operation} of ${packageName}: ${message(error)}`)
    return false
  }
}

/** Mark the operation finished; anything left after this point is committed. */
export function completeOperation(profileDir: string): void {
  try {
    rmSync(journalPath(profileDir), { force: true })
  } catch (error) {
    log.warn(`market: could not clear the install journal: ${message(error)}`)
  }
}

/** Read an outstanding journal entry, if the last operation never completed. */
export function readJournal(profileDir: string): InstallJournalEntry | undefined {
  const path = journalPath(profileDir)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<InstallJournalEntry>
    if (
      (parsed.operation !== 'install' && parsed.operation !== 'uninstall')
      || typeof parsed.packageName !== 'string'
      || typeof parsed.priorManifest !== 'string'
      || typeof parsed.startedAt !== 'string'
    ) {
      return undefined
    }
    return {
      operation: parsed.operation,
      packageName: parsed.packageName,
      version: typeof parsed.version === 'string' ? parsed.version : null,
      startedAt: parsed.startedAt,
      priorManifest: parsed.priorManifest,
    }
  } catch {
    return undefined
  }
}

/**
 * Put the profile manifest back the way it was and clear the journal.
 *
 * Leftover `node_modules` content is deliberately not touched: it is inert once
 * the manifest no longer names it, and deleting trees during recovery is how a
 * bad situation becomes an unrecoverable one.
 */
export function rollback(profileDir: string): InstallJournalEntry | undefined {
  const entry = readJournal(profileDir)
  if (entry === undefined) {
    completeOperation(profileDir)
    return undefined
  }
  try {
    writeFileSync(join(profileDir, 'package.json'), entry.priorManifest)
    log.warn(`market: rolled back an incomplete ${entry.operation} of ${entry.packageName}`)
  } catch (error) {
    log.error(`market: rollback of ${entry.packageName} failed: ${message(error)}`)
    return entry
  }
  completeOperation(profileDir)
  return entry
}

/**
 * Startup recovery: undo any operation that never reported completion.
 * Returns the entry that was rolled back, so the shell can say what happened.
 */
export function recoverIncompleteInstall(profileDir: string): InstallJournalEntry | undefined {
  const entry = readJournal(profileDir)
  if (entry === undefined) return undefined
  log.warn(`market: found an unfinished ${entry.operation} of ${entry.packageName} from ${entry.startedAt}`)
  return rollback(profileDir)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
