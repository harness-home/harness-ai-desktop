import { createWriteStream, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { maskSecrets } from './mask-secrets'

const MAX_LOG_BYTES = 5 * 1024 * 1024

let stream: WriteStream | undefined

export function logsDir(): string {
  return join(app.getPath('userData'), 'logs')
}

export function logFilePath(): string {
  return join(logsDir(), 'main.log')
}

/** Open the session log file, rotating the previous one past the size cap. */
export function initFileLog(): void {
  const dir = logsDir()
  mkdirSync(dir, { recursive: true })
  const file = logFilePath()
  try {
    if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, join(dir, 'main.previous.log'))
  } catch {
    // Missing file on first run; rotation failure only costs a larger file.
  }
  stream = createWriteStream(file, { flags: 'a' })
}

function write(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `${new Date().toISOString()} [${level}] ${maskSecrets(message)}`
  if (level === 'error') console.error(line)
  else console.log(line)
  stream?.write(`${line}\n`)
}

export const log = {
  info: (message: string): void => write('info', message),
  warn: (message: string): void => write('warn', message),
  error: (message: string): void => write('error', message),
}
