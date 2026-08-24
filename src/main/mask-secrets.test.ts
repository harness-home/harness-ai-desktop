import { describe, expect, it } from 'vitest'
import { maskSecrets } from './mask-secrets'

const DIGEST = 'sha256:9f2c4b1a8d3e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8'

describe('maskSecrets', () => {
  it('masks named credential fields', () => {
    expect(maskSecrets('api_key=abcdef123456')).toBe('api_key=****')
    expect(maskSecrets('{"password":"hunter2"}')).toContain('password":"****')
  })

  it('masks auth headers and bearer schemes', () => {
    expect(maskSecrets('Authorization: Bearer abc.def')).toBe('Authorization: ****')
    expect(maskSecrets('sent Bearer abc.def-ghi')).toBe('sent Bearer ****')
  })

  it('masks sk- keys and bare long tokens', () => {
    expect(maskSecrets('key sk-abcdefghijklmnop')).toBe('key sk-****')
    expect(maskSecrets('t=ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')).toBe('t=ABC****')
  })

  it('masks url userinfo and sensitive query values', () => {
    expect(maskSecrets('https://user:pw@example.com/')).toContain('****')
    expect(maskSecrets('https://example.com/?token=abc')).toContain('token=****')
  })

  it('leaves content-addressed digests intact', () => {
    // Attachment ids are looked up verbatim; masking one loses the blob.
    expect(maskSecrets(DIGEST)).toBe(DIGEST)
    expect(maskSecrets(`{"attachmentId":"${DIGEST}","bytes":1}`)).toContain(DIGEST)
  })

  it('still masks a long token that merely sits near a digest', () => {
    const masked = maskSecrets(`${DIGEST} ABCDEFGHIJKLMNOPQRSTUVWXYZ012345`)
    expect(masked).toContain(DIGEST)
    expect(masked).toContain('ABC****')
  })
})
