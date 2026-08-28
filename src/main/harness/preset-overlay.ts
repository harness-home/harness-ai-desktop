// Shipped agent-preset root overlay, kept as its own dependency-free module so
// the composition rule below can be unit tested without booting a runtime.
//
// Why an overlay at all: the preset roster ships inside the `@deepseek-ai/dsh`
// package, next to this app's own config in both the source and the built
// layout. Only the app can resolve that path, so the composed `agent-presets`
// row cannot name it itself.
//
// Why PREPEND rather than replace: the row's `roots` is a user-facing setting —
// a profile's cordis.patch.yml may configure its own preset roots. Replacing
// the list dropped every one of them, silently. Prepending keeps them live
// while the shipped root still wins a duplicate id, because the roster resolves
// roots in order and the shipped root carries `system` trust. Upstream shipped
// the same defect and fixed it the same way (deepseek-ai/deepseek-harness#2863,
// externally reported as #3636).

/** Row id the preset roster carries in every composed tree. */
export const PRESET_ROW_ID = 'agent-presets'

/** Trust level the shipped root is mounted under. */
export const SHIPPED_ROOT_TRUST = 'system'

/** The composed row this overlay derives from; only `config` is read. */
export interface ComposedPresetRow {
  config?: unknown
}

/**
 * Whether a value is a config mapping this overlay may rewrite. Rejects arrays
 * and class instances (a `!!js` expression node parses to one), because
 * spreading either would silently produce a different config than the profile
 * asked for.
 */
function isRewritableMapping(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype || prototype === null
}

/**
 * Overlay rows prepending the shipped preset root to the composition's roots.
 *
 * @param row - the composed `agent-presets` row, or undefined when the tree has none.
 * @param shippedRoot - absolute path of the roster shipped inside `@deepseek-ai/dsh`.
 * @returns a single-element patch list, or an empty list when the tree has no roster row.
 * @throws TypeError when the composed config, or its `roots`, is not a literal
 * the launcher can statically rewrite — failing loud beats dropping a root.
 */
export function presetRootOverlays(
  row: ComposedPresetRow | undefined,
  shippedRoot: string,
): object[] {
  if (row === undefined) return []
  const config: unknown = row.config ?? {}
  if (!isRewritableMapping(config)) {
    throw new TypeError(
      `${PRESET_ROW_ID} config must be a literal mapping — the launcher prepends the shipped preset root into it`,
    )
  }
  const configured: unknown = config.roots ?? []
  if (!Array.isArray(configured)) {
    throw new TypeError(
      `${PRESET_ROW_ID} config.roots must be a literal array — the launcher prepends the shipped preset root into it`,
    )
  }
  return [{
    id: PRESET_ROW_ID,
    config: {
      ...config,
      roots: [{ path: shippedRoot, trust: SHIPPED_ROOT_TRUST }, ...configured as readonly unknown[]],
    },
  }]
}
