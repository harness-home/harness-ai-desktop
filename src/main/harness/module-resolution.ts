// Profile-aware module resolution for the Loader.
//
// The Loader imports every plugin row by bare package name from its own
// location inside the app installation, so a plugin the market installed into
// the profile directory is invisible and the whole tree fails to boot. This
// hook keeps installation packages authoritative (a profile copy must never
// shadow the in-box runtime) and falls back to the profile only for names the
// installation does not have — which is exactly the market's install target.
//
// Approach adapted from anywhere-labs/deepseek-harness-desktop (MIT); ours is
// the narrow half: no package overlay/version arbitration, just the fallback.
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

/** Whether a specifier needs Node package resolution (not a path or URL). */
function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !URL.canParse(specifier)
}

/**
 * Let Loader imports fall back to the profile's own node_modules.
 * @param profileDir - the active profile directory.
 * @returns an idempotent disposer removing the hook.
 */
export function installProfileFallbackResolver(profileDir: string): () => void {
  const profileAnchor = pathToFileURL(`${profileDir}/package.json`).href
  // Modules loaded out of the profile keep resolving from there, so a plugin's
  // own dependencies resolve beside it rather than against the app tree.
  const profileModuleUrls = new Set<string>()

  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const fromProfileModule = context.parentURL !== undefined && profileModuleUrls.has(context.parentURL)
      if (!isBareSpecifier(specifier)) {
        const resolved = nextResolve(specifier, context)
        if (fromProfileModule && specifier.startsWith('.')) profileModuleUrls.add(resolved.url)
        return resolved
      }
      try {
        const resolved = nextResolve(specifier, context)
        if (fromProfileModule) profileModuleUrls.add(resolved.url)
        return resolved
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw cause
        // Unknown to the installation: try the profile before failing.
        const resolved = nextResolve(specifier, { ...context, parentURL: profileAnchor })
        profileModuleUrls.add(resolved.url)
        return resolved
      }
    },
  })

  let active = true
  return () => {
    if (!active) return
    active = false
    hooks.deregister()
  }
}
