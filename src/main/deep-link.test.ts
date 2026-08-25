import { describe, expect, it } from 'vitest'
import { deepLinkFromArgv, parseDeepLink } from './deep-link'

// A deep link is untrusted input from a browser. These cases pin the two
// properties that matter: only known actions are accepted, and the only payload
// that survives is a catalog id the contract itself accepts.
describe('parseDeepLink', () => {
  it('accepts an install link and returns the listing id', () => {
    expect(parseDeepLink('harness-ai://install?listing=npm:dsh-plugin-hello&from=web')).toEqual({
      kind: 'install',
      listingId: 'npm:dsh-plugin-hello',
    })
  })

  it('accepts the path form some platforms produce', () => {
    expect(parseDeepLink('harness-ai:///install?listing=dsh-web-app')).toEqual({
      kind: 'install',
      listingId: 'dsh-web-app',
    })
  })

  it('decodes a percent-encoded id', () => {
    expect(parseDeepLink('harness-ai://install?listing=npm%3A%40scope%2Fplugin')).toEqual({
      kind: 'install',
      listingId: 'npm:@scope/plugin',
    })
  })

  it('accepts a bare open link', () => {
    expect(parseDeepLink('harness-ai://open')).toEqual({ kind: 'open' })
  })

  it('rejects another scheme', () => {
    expect(parseDeepLink('https://harnessai.io/en/plugins')).toBeNull()
  })

  it('rejects an unknown action', () => {
    expect(parseDeepLink('harness-ai://uninstall?listing=dsh-web-app')).toBeNull()
  })

  it('rejects an install link with no listing', () => {
    expect(parseDeepLink('harness-ai://install')).toBeNull()
  })

  it('rejects an id the catalog contract would not accept', () => {
    expect(parseDeepLink('harness-ai://install?listing=../../etc/passwd')).toBeNull()
    expect(parseDeepLink('harness-ai://install?listing=')).toBeNull()
    expect(parseDeepLink(`harness-ai://install?listing=${'a'.repeat(200)}`)).toBeNull()
  })

  it('carries no package name, so a link cannot choose what is installed', () => {
    const request = parseDeepLink('harness-ai://install?listing=dsh-web-app&package=evil&version=9.9.9')
    expect(request).toEqual({ kind: 'install', listingId: 'dsh-web-app' })
  })
})

describe('deepLinkFromArgv', () => {
  it('finds the link among launcher arguments', () => {
    expect(deepLinkFromArgv(['electron.exe', '--flag', 'harness-ai://install?listing=x'])).toBe(
      'harness-ai://install?listing=x',
    )
  })

  it('returns undefined for an ordinary launch', () => {
    expect(deepLinkFromArgv(['electron.exe', '.'])).toBeUndefined()
  })
})
