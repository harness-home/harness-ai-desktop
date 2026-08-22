/** Harness AI brand mark and wordmark for the shipped brand slots. */

export const BRAND_NAME = 'Harness AI'

export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" width="1.5em" height="1.5em" aria-label={BRAND_NAME} role="img">
      <rect x={2} y={2} width={28} height={28} rx={7} fill="currentColor" opacity={0.15} />
      {/* A stylized "H" of two pillars and a crossbar. */}
      <rect x={8} y={8} width={4} height={16} rx={2} fill="currentColor" />
      <rect x={20} y={8} width={4} height={16} rx={2} fill="currentColor" />
      <rect x={10} y={14} width={12} height={4} rx={2} fill="currentColor" />
    </svg>
  )
}

export function BrandName() {
  return <span>{BRAND_NAME}</span>
}
