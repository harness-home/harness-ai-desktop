// Pre-install verification for market packages.
//
// The catalog records the tarball integrity it saw when it ingested a version.
// Before installing, the client reads that same field from the registry and
// refuses when the two disagree. That single comparison is what closes the
// chain: pnpm verifies the downloaded tarball against the registry's integrity,
// and this verifies the registry's integrity against the catalog's, so what
// lands on disk is the artifact the catalog described.
//
// It catches the case a version pin alone does not: a version republished under
// a stolen publish token keeps its number and changes its bytes.

/** The only registry the installer will talk to. */
export const REGISTRY_URL = 'https://registry.npmjs.org'

const REQUEST_TIMEOUT_MS = 20_000

export type IntegrityVerdict =
  | { ok: true; integrity: string }
  | { ok: false; code: 'integrity_mismatch' | 'integrity_unavailable' | 'registry_unreachable' | 'version_missing'; detail: string }

interface PackumentVersion {
  dist?: { integrity?: string }
}

interface Packument {
  versions?: Record<string, PackumentVersion>
}

/** Registry lookup, injectable so the verification logic is testable offline. */
export type PackumentFetcher = (packageName: string) => Promise<Packument>

export async function fetchPackument(packageName: string): Promise<Packument> {
  // Scoped names keep their '@' in a registry path; only the '/' is escaped.
  const path = encodeURIComponent(packageName).replace('%40', '@')
  const response = await fetch(`${REGISTRY_URL}/${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`registry returned ${String(response.status)}`)
  return (await response.json()) as Packument
}

/**
 * Confirm the registry still serves the exact artifact the catalog recorded.
 *
 * @param expected - integrity string from the catalog listing, or null when the
 *   catalog has none. A listing without one is not installable, so this reports
 *   `integrity_unavailable` rather than silently proceeding unverified.
 */
export async function verifyIntegrity(
  packageName: string,
  version: string,
  expected: string | null,
  fetcher: PackumentFetcher = fetchPackument,
): Promise<IntegrityVerdict> {
  if (expected === null || expected === '') {
    return {
      ok: false,
      code: 'integrity_unavailable',
      detail: 'the catalog holds no integrity hash for this version',
    }
  }
  let packument: Packument
  try {
    packument = await fetcher(packageName)
  } catch (error) {
    return {
      ok: false,
      code: 'registry_unreachable',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
  const actual = packument.versions?.[version]?.dist?.integrity
  if (typeof actual !== 'string' || actual === '') {
    return {
      ok: false,
      code: 'version_missing',
      detail: `the registry no longer serves ${packageName}@${version}`,
    }
  }
  if (actual !== expected) {
    return {
      ok: false,
      code: 'integrity_mismatch',
      detail: `${packageName}@${version} no longer matches the artifact the catalog verified`,
    }
  }
  return { ok: true, integrity: actual }
}
