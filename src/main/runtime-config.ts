// Client configuration a deployment can change after installation.
//
// One JSON file sits next to the executable (`harness-ai.config.json`) and is
// read once per run. It exists for settings that are environmental rather than
// personal — the ones a network, not a user, decides — so they can be corrected
// on a machine that is already installed, without a rebuild and without a
// developer.
//
// Precedence is environment variable > config file > built-in default, the same
// order `updater.ts` uses for the update feed: an operator's ad-hoc override
// always outranks what is on disk.
//
// Nothing here may throw into startup. A missing, unreadable or malformed file
// leaves the defaults in place and logs why — a client that will not start is a
// far worse outcome than one talking to the default registry.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { log } from './log'

/** Config file name, shipped by the installer and editable in place afterwards. */
export const CONFIG_FILENAME = 'harness-ai.config.json'

/** Registry used when nothing overrides it. */
export const DEFAULT_PLUGIN_REGISTRY = 'https://registry.npmjs.org'

/** Environment variable that outranks the config file. */
export const REGISTRY_ENV_VAR = 'HARNESS_PLUGIN_REGISTRY'

/**
 * Hosted service a packaged client talks to when nothing overrides it.
 *
 * A shipped installer cannot default to a server on the machine running it:
 * nobody outside this repository has one, so every installed client would sit
 * there unable to sign in. Self-hosted deployments point their clients
 * elsewhere through the config file — which is what that file is for.
 */
export const DEFAULT_SERVER_URL = 'https://api.harnessai.io'

/**
 * Development runs default to the local server instead, so `pnpm dev` keeps
 * talking to the one the developer just started rather than to production.
 */
export const DEV_SERVER_URL = 'http://localhost:8720'

/** Environment variable that outranks the config file. */
export const SERVER_URL_ENV_VAR = 'HARNESS_SERVER_URL'

export interface RegistryResolution {
  /** Canonical URL with no trailing slash; request paths are appended to it. */
  url: string
  where: 'env' | 'file' | 'default'
  /** Set when a supplied value was rejected and the next source was used. */
  warning?: string
}

/**
 * Canonical form of a registry URL, or undefined when it is not one this client
 * will talk to. Only http(s) is accepted: a registry is fetched with `fetch`
 * and handed to pnpm, and neither has anything to do with other schemes.
 */
function normalizeRegistry(value: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
  return parsed.href.replace(/\/+$/, '')
}

/**
 * Decide the plugin registry from the environment and the config file. Pure, so
 * the precedence and the rejection rules are testable without a packaged app.
 *
 * @param override - value of HARNESS_PLUGIN_REGISTRY, if set.
 * @param fileText - contents of the config file, if it could be read.
 */
function resolveUrl(input: {
  override: string | undefined
  fileText: string | undefined
  field: string
  envVar: string
  fallback: string
}): RegistryResolution {
  const { override, fileText, field, envVar, fallback } = input
  let warning: string | undefined

  if (override !== undefined && override.trim() !== '') {
    const url = normalizeRegistry(override)
    if (url !== undefined) return { url, where: 'env' }
    warning = `${envVar} is not an http(s) URL; ignoring it`
  }

  if (fileText !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(fileText)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { url: fallback, where: 'default', warning: warning ?? `${CONFIG_FILENAME} is not valid JSON (${detail})` }
    }
    const configured = (parsed as Record<string, unknown> | null)?.[field]
    if (typeof configured === 'string' && configured.trim() !== '') {
      const url = normalizeRegistry(configured)
      if (url !== undefined) return { url, where: 'file', ...(warning === undefined ? {} : { warning }) }
      warning ??= `${CONFIG_FILENAME}: ${field} is not an http(s) URL; ignoring it`
    } else if (configured !== undefined) {
      warning ??= `${CONFIG_FILENAME}: ${field} must be a string; ignoring it`
    }
  }

  return { url: fallback, where: 'default', ...(warning === undefined ? {} : { warning }) }
}

export function resolveRegistry(override: string | undefined, fileText: string | undefined): RegistryResolution {
  return resolveUrl({
    override,
    fileText,
    field: 'pluginRegistry',
    envVar: REGISTRY_ENV_VAR,
    fallback: DEFAULT_PLUGIN_REGISTRY,
  })
}

/**
 * Decide the hosted service endpoint. Same precedence and same rejection rules
 * as the registry; the fallback is passed in because it differs between a
 * packaged client and a development run, and this function stays pure.
 */
export function resolveServerUrl(
  override: string | undefined,
  fileText: string | undefined,
  fallback: string,
): RegistryResolution {
  return resolveUrl({ override, fileText, field: 'serverUrl', envVar: SERVER_URL_ENV_VAR, fallback })
}

/**
 * Where the config file lives. Packaged, that is the installation directory
 * beside the executable — the place a person who installed the client can
 * actually find. Unpackaged, it is the repository root, so a development run
 * can exercise the same file.
 */
export function configFilePath(): string {
  const dir = app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath()
  return join(dir, CONFIG_FILENAME)
}

let cached: RegistryResolution | undefined
let cachedServer: RegistryResolution | undefined

/** The config file's contents, or undefined when there is nothing to read. */
function configText(): string | undefined {
  const path = configFilePath()
  try {
    if (existsSync(path)) return readFileSync(path, 'utf8')
  } catch (error) {
    log.warn(`config: ${CONFIG_FILENAME} could not be read (${error instanceof Error ? error.message : String(error)})`)
  }
  return undefined
}

/** Read the config file once per run; a read failure is a missing file. */
function resolution(): RegistryResolution {
  if (cached !== undefined) return cached
  cached = resolveRegistry(process.env[REGISTRY_ENV_VAR], configText())
  if (cached.warning !== undefined) log.warn(`config: ${cached.warning}`)
  log.info(`config: plugin registry ${cached.url} (${cached.where})`)
  return cached
}

/** Registry the plugin market installs from, canonical and without a trailing slash. */
export function pluginRegistry(): string {
  return resolution().url
}

/** The same registry in the trailing-slash form npm settings and pnpm expect. */
export function pluginRegistryForNpm(): string {
  return `${resolution().url}/`
}

/**
 * Hosted service this client talks to, canonical and without a trailing slash.
 *
 * The built-in default depends on the build: a packaged installer points at the
 * hosted service, an unpackaged run at the local server. Both are outranked by
 * the config file, and that by the environment variable.
 */
export function serverUrl(): string {
  if (cachedServer === undefined) {
    const fallback = app.isPackaged ? DEFAULT_SERVER_URL : DEV_SERVER_URL
    cachedServer = resolveServerUrl(process.env[SERVER_URL_ENV_VAR], configText(), fallback)
    if (cachedServer.warning !== undefined) log.warn(`config: ${cachedServer.warning}`)
    log.info(`config: server ${cachedServer.url} (${cachedServer.where})`)
  }
  return cachedServer.url
}

/** Test seam: forget the cached read so the next call re-resolves. */
export function resetRuntimeConfig(): void {
  cached = undefined
  cachedServer = undefined
}
