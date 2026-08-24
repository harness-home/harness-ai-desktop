// Mask secret-shaped substrings before a line reaches the log file. Coverage
// follows the reference desktop shell: named credential fields, auth headers,
// URL userinfo/query secrets, and bare token-shaped strings.

const MASK = '****'

const FIELD_NAMES = String.raw`access[_-]?token|(?:x[_-])?api[_-]?key|authorization|auth|client[_-]?secret|credential|id[_-]?token|password|passwd|private[_-]?key|refresh[_-]?token|secret|session(?:id)?|signature|token`

const NAMED_FIELD = new RegExp(String.raw`\b(${FIELD_NAMES})\b(["']?\s*[:=]\s*["']?)[^\s"',;&]+`, 'giu')
const AUTH_HEADER = /\b(Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]*/giu
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9+/._=-]+/giu
const SK_KEY = /\bsk-[A-Za-z0-9]{12,}/gu
/**
 * Bare token-shaped strings, minus content-addressed digests. A `sha256:` id is
 * an identifier, not a credential: it reveals nothing, and masking it breaks
 * every lookup keyed by it — attachment sync fetches blobs by exactly this id,
 * so a masked digest silently loses the image.
 */
const LONG_TOKEN = /(?<!\bsha256:)\b[A-Za-z0-9]{32,}\b/gu
const WEB_URL = /https?:\/\/[^\s<>"']+/giu
const SENSITIVE_QUERY = /auth|code|credential|key|password|secret|signature|token/iu

function maskUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.username !== '') url.username = MASK
    if (url.password !== '') url.password = MASK
    for (const name of url.searchParams.keys()) {
      if (SENSITIVE_QUERY.test(name)) url.searchParams.set(name, MASK)
    }
    return url.href
  } catch {
    return raw
  }
}

/** Replace secret-shaped substrings in a rendered log line. */
export function maskSecrets(text: string): string {
  return text
    .replace(WEB_URL, maskUrl)
    .replace(AUTH_HEADER, (_m, name: string) => `${name}: ${MASK}`)
    .replace(NAMED_FIELD, (_m, name: string, sep: string) => `${name}${sep}${MASK}`)
    .replace(BEARER, (_m, scheme: string) => `${scheme} ${MASK}`)
    .replace(SK_KEY, (m) => `${m.slice(0, 3)}${MASK}`)
    .replace(LONG_TOKEN, (m) => `${m.slice(0, 3)}${MASK}`)
}
