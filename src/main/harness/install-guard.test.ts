import { describe, expect, it } from 'vitest'
import { verifyIntegrity } from './install-guard'

const INTEGRITY = 'sha512-abcdefghijklmnopqrstuvwxyz0123456789=='
const OTHER = 'sha512-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz=='

function registry(versions: Record<string, { dist?: { integrity?: string } }>) {
  return () => Promise.resolve({ versions })
}

describe('verifyIntegrity', () => {
  it('accepts a version the registry still serves unchanged', async () => {
    const verdict = await verifyIntegrity(
      'dsh-plugin-hello',
      '0.1.0',
      INTEGRITY,
      registry({ '0.1.0': { dist: { integrity: INTEGRITY } } }),
    )
    expect(verdict).toEqual({ ok: true, integrity: INTEGRITY })
  })

  it('refuses a version whose artifact changed under the same number', async () => {
    // The republish case: same version, different bytes.
    const verdict = await verifyIntegrity(
      'dsh-plugin-hello',
      '0.1.0',
      INTEGRITY,
      registry({ '0.1.0': { dist: { integrity: OTHER } } }),
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('integrity_mismatch')
  })

  it('refuses when the catalog holds no integrity to compare against', async () => {
    const verdict = await verifyIntegrity('p', '1.0.0', null, registry({ '1.0.0': { dist: { integrity: INTEGRITY } } }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('integrity_unavailable')
  })

  it('refuses when the registry no longer serves that version', async () => {
    const verdict = await verifyIntegrity('p', '1.0.0', INTEGRITY, registry({ '2.0.0': { dist: { integrity: OTHER } } }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('version_missing')
  })

  it('refuses when the version carries no integrity at all', async () => {
    const verdict = await verifyIntegrity('p', '1.0.0', INTEGRITY, registry({ '1.0.0': {} }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('version_missing')
  })

  it('reports an unreachable registry rather than proceeding', async () => {
    const verdict = await verifyIntegrity('p', '1.0.0', INTEGRITY, () => Promise.reject(new Error('offline')))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe('registry_unreachable')
      expect(verdict.detail).toContain('offline')
    }
  })
})
