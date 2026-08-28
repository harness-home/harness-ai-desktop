import { describe, expect, it } from 'vitest'
import { presetRootOverlays, PRESET_ROW_ID, SHIPPED_ROOT_TRUST } from './preset-overlay'

// Roots are opaque strings to this module, so the fixtures use one separator
// spelling rather than branching on the host platform.
const SHIPPED = 'C:/app/dsh/config/agent-presets/'

interface PresetPatch {
  id: string
  config: { roots: { path: string; trust: string }[] } & Record<string, unknown>
}

function patch(row: { config?: unknown } | undefined): PresetPatch {
  const [only] = presetRootOverlays(row, SHIPPED)
  return only as PresetPatch
}

describe('presetRootOverlays', () => {
  it('returns no overlay when the composed tree has no roster row', () => {
    expect(presetRootOverlays(undefined, SHIPPED)).toEqual([])
  })

  it('mounts the shipped root when the row configures none', () => {
    expect(patch({}).config.roots).toEqual([{ path: SHIPPED, trust: SHIPPED_ROOT_TRUST }])
  })

  it('keeps roots a profile configured, instead of replacing them', () => {
    // The regression this pins: the overlay used to REPLACE `roots` with the
    // shipped root alone, so every root a profile's cordis.patch.yml declared
    // vanished from the roster with no diagnostic.
    const configured = [{ path: 'D:/team/presets/', trust: 'user' }]
    expect(patch({ config: { roots: configured } }).config.roots).toEqual([
      { path: SHIPPED, trust: SHIPPED_ROOT_TRUST },
      ...configured,
    ])
  })

  it('puts the shipped root first, so it wins a duplicate preset id', () => {
    const roots = patch({ config: { roots: [{ path: 'D:/other/', trust: 'user' }] } }).config.roots
    expect(roots[0]).toEqual({ path: SHIPPED, trust: SHIPPED_ROOT_TRUST })
  })

  it('carries every other configured key through untouched', () => {
    const result = patch({ config: { roots: [], writable: 'D:/mine/', extra: 7 } })
    expect(result.config.writable).toBe('D:/mine/')
    expect(result.config.extra).toBe(7)
  })

  it('names the roster row so the patch lands on it', () => {
    expect(patch({}).id).toBe(PRESET_ROW_ID)
  })

  it('does not mutate the composed row it derives from', () => {
    const config = { roots: [{ path: 'D:/team/', trust: 'user' }] }
    patch({ config })
    expect(config.roots).toHaveLength(1)
  })

  it('fails loud on a config the launcher cannot statically rewrite', () => {
    // A `!!js` expression node parses to a class instance, not a plain mapping;
    // spreading it would quietly compose a different config than was asked for.
    class JsExpr { roots = [] }
    expect(() => presetRootOverlays({ config: new JsExpr() }, SHIPPED)).toThrow(TypeError)
    expect(() => presetRootOverlays({ config: [] }, SHIPPED)).toThrow(TypeError)
  })

  it('fails loud on a roots value that is not a literal array', () => {
    expect(() => presetRootOverlays({ config: { roots: 'D:/team/' } }, SHIPPED)).toThrow(TypeError)
  })
})
