import { describe, expect, it } from 'vitest'
import { CONFIG_FILENAME, DEFAULT_PLUGIN_REGISTRY, resolveRegistry } from './runtime-config'

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
