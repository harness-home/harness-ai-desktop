import enUS from './locales/en-US.json'
import zhCN from './locales/zh-CN.json'

export const SUPPORTED_LOCALES = ['en-US', 'zh-CN'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

// Fixed fallback per workspace decision (ledger #11): explicit choice -> system -> en-US.
export const FALLBACK_LOCALE: Locale = 'en-US'

const MESSAGES: Record<Locale, Record<string, string>> = {
  'en-US': enUS,
  'zh-CN': zhCN,
}

function matchSupported(tag: string): Locale | undefined {
  const lower = tag.toLowerCase()
  return SUPPORTED_LOCALES.find(
    (locale) => locale.toLowerCase() === lower || locale.slice(0, 2) === lower.slice(0, 2),
  )
}

export function resolveLocale(explicit: string | undefined, systemTags: readonly string[]): Locale {
  if (explicit) {
    const matched = matchSupported(explicit)
    if (matched) return matched
  }
  for (const tag of systemTags) {
    const matched = matchSupported(tag)
    if (matched) return matched
  }
  return FALLBACK_LOCALE
}

export function t(locale: Locale, key: string): string {
  return MESSAGES[locale][key] ?? MESSAGES[FALLBACK_LOCALE][key] ?? key
}
