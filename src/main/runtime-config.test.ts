import { describe, expect, it } from 'vitest'
import {
  CONFIG_FILENAME,
  DEFAULT_PLUGIN_REGISTRY,
  DEFAULT_SERVER_URL,
  DEV_SERVER_URL,
  resolveRegistry,
  resolveServerUrl,
} from './runtime-config'

// The config file is edited by hand on an installed machine, so every case here
// is a file someone typed rather than a file a program wrote. The rule the
// tests pin: a bad value never becomes the registry, and never stops the client
// — it falls back and says so.
function file(pluginRegistry: unknown): string {
  return JSON.stringify({ pluginRegistry })
}

describe('resolveRegistry', () => {
  it('uses the public registry when nothing is configured', () => {
    expect(resolveRegistry(undefined, undefined)).toEqual({ url: DEFAULT_PLUGIN_REGISTRY, where: 'default' })
  })

  it('takes the registry from the config file', () => {
    expect(resolveRegistry(undefined, file('https://registry.npmmirror.com/'))).toEqual({
      url: 'https://registry.npmmirror.com',
      where: 'file',
    })
  })

  it('strips trailing slashes so request paths append cleanly', () => {
    expect(resolveRegistry(undefined, file('https://registry.npmmirror.com///')).url)
      .toBe('https://registry.npmmirror.com')
  })

  it('lets the environment variable outrank the file', () => {
    const resolved = resolveRegistry('https://mirror.internal/npm/', file('https://registry.npmmirror.com/'))
    expect(resolved).toEqual({ url: 'https://mirror.internal/npm', where: 'env' })
  })

  it('ignores an empty environment variable rather than treating it as a value', () => {
    expect(resolveRegistry('   ', file('https://registry.npmmirror.com/')).where).toBe('file')
  })

  it('falls back to the file when the environment variable is not a URL', () => {
    const resolved = resolveRegistry('npmmirror', file('https://registry.npmmirror.com/'))
    expect(resolved.url).toBe('https://registry.npmmirror.com')
    expect(resolved.where).toBe('file')
    expect(resolved.warning).toContain('HARNESS_PLUGIN_REGISTRY')
  })

  it('refuses a scheme neither fetch nor pnpm would use', () => {
    const resolved = resolveRegistry(undefined, file('file:///c:/packages'))
    expect(resolved.url).toBe(DEFAULT_PLUGIN_REGISTRY)
    expect(resolved.warning).toContain('http(s)')
  })

  it('survives a file that is not valid JSON', () => {
    const resolved = resolveRegistry(undefined, '{ pluginRegistry: nope }')
    expect(resolved.url).toBe(DEFAULT_PLUGIN_REGISTRY)
    expect(resolved.where).toBe('default')
    expect(resolved.warning).toContain(CONFIG_FILENAME)
  })

  it('survives a file whose key holds the wrong type', () => {
    const resolved = resolveRegistry(undefined, file(42))
    expect(resolved.url).toBe(DEFAULT_PLUGIN_REGISTRY)
    expect(resolved.warning).toContain('must be a string')
  })

  it('ignores a file that configures nothing', () => {
    expect(resolveRegistry(undefined, JSON.stringify({ '//': ['docs'] }))).toEqual({
      url: DEFAULT_PLUGIN_REGISTRY,
      where: 'default',
    })
  })
})

// The server endpoint follows the same precedence as the registry, and matters
// more: get it wrong and an installed client cannot sign in at all. The default
// is passed in because it differs between a packaged build and a dev run, so
// these cases pin the resolution rather than the packaging decision.
function serverFile(serverUrl: unknown): string {
  return JSON.stringify({ serverUrl })
}

describe('resolveServerUrl', () => {
  it('uses the fallback it is given when nothing is configured', () => {
    expect(resolveServerUrl(undefined, undefined, DEFAULT_SERVER_URL)).toEqual({
      url: DEFAULT_SERVER_URL,
      where: 'default',
    })
    expect(resolveServerUrl(undefined, undefined, DEV_SERVER_URL).url).toBe(DEV_SERVER_URL)
  })

  it('lets a deployment point an installed client at its own server', () => {
    expect(resolveServerUrl(undefined, serverFile('https://harness.internal.example/'), DEFAULT_SERVER_URL)).toEqual({
      url: 'https://harness.internal.example',
      where: 'file',
    })
  })

  it('lets the environment variable outrank the file', () => {
    expect(resolveServerUrl('http://localhost:8720', serverFile('https://harness.internal.example'), DEFAULT_SERVER_URL)).toEqual({
      url: 'http://localhost:8720',
      where: 'env',
    })
  })

  it('keeps the fallback when the file holds something that is not a URL', () => {
    const resolved = resolveServerUrl(undefined, serverFile('not a url'), DEFAULT_SERVER_URL)
    expect(resolved.url).toBe(DEFAULT_SERVER_URL)
    expect(resolved.warning).toContain(`${CONFIG_FILENAME}: serverUrl`)
  })

  it('does not read the registry key by mistake', () => {
    // Both settings live in one file; picking up the wrong one would send
    // account traffic to a package registry.
    const resolved = resolveServerUrl(undefined, JSON.stringify({ pluginRegistry: 'https://registry.npmmirror.com' }), DEFAULT_SERVER_URL)
    expect(resolved).toEqual({ url: DEFAULT_SERVER_URL, where: 'default' })
  })

  it('survives a file that is not valid JSON', () => {
    const resolved = resolveServerUrl(undefined, '{ oops', DEFAULT_SERVER_URL)
    expect(resolved.url).toBe(DEFAULT_SERVER_URL)
    expect(resolved.warning).toContain('not valid JSON')
  })
})
