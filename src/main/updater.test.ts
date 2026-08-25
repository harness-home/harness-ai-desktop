import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getVersion: () => '0.0.0' } }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: { on: () => {} } } }))
vi.mock('./log', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

const { resolveFeed } = await import('./updater')

const PACKAGED_PLACEHOLDER = [
  'provider: generic',
  'url: https://updates.invalid/desktop/win-x64',
  'channel: latest',
].join('\n')

const PACKAGED_REAL = [
  'provider: generic',
  'url: https://updates.example.com/harness/win-x64',
  'channel: latest',
].join('\n')

describe('resolveFeed', () => {
  it('prefers the environment override over the packaged config', () => {
    expect(resolveFeed('http://127.0.0.1:8799', PACKAGED_REAL)).toEqual({
      kind: 'override',
      url: 'http://127.0.0.1:8799',
    })
  })

  it('uses the override even when the build carries only the placeholder', () => {
    // This is how the update path is tested and how a private deployment runs.
    expect(resolveFeed('http://127.0.0.1:8799', PACKAGED_PLACEHOLDER)).toEqual({
      kind: 'override',
      url: 'http://127.0.0.1:8799',
    })
  })

  it('trims a padded override', () => {
    expect(resolveFeed('  https://example.com/feed  ', undefined)).toEqual({
      kind: 'override',
      url: 'https://example.com/feed',
    })
  })

  it('ignores an empty override', () => {
    expect(resolveFeed('   ', PACKAGED_REAL)).toEqual({ kind: 'packaged' })
  })

  it('uses a real packaged feed', () => {
    expect(resolveFeed(undefined, PACKAGED_REAL)).toEqual({ kind: 'packaged' })
  })

  it('treats the placeholder host as no feed at all', () => {
    // Otherwise every client would sit in a permanent update-check failure,
    // which reads as a defect rather than a decision nobody has made yet.
    expect(resolveFeed(undefined, PACKAGED_PLACEHOLDER)).toEqual({ kind: 'none' })
  })

  it('accepts a feed on the real site domain', () => {
    // Guards the sentinel swap: the placeholder must not match the host the
    // feed will actually live on once distribution is set up (ledger #31).
    const onSiteDomain = [
      'provider: generic',
      'url: https://download.harnessai.io/desktop/win-x64',
      'channel: latest',
    ].join('\n')
    expect(resolveFeed(undefined, onSiteDomain)).toEqual({ kind: 'packaged' })
  })

  it('reports no feed when the build carries no config', () => {
    expect(resolveFeed(undefined, undefined)).toEqual({ kind: 'none' })
  })
})
