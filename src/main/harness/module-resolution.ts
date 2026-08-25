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
//
// Two halves, because the runtime resolves through two module systems. The ESM
// hook below covers `import`. The CommonJS half covers `createRequire()`, which
// dsh uses to read package metadata against the composed tree's own base — the
// profile directory — and which reaches the installation only through the
// symlink farm `dsh-app-boot` builds in `<dsh home>/profiles/node_modules`.
// See `installInstallationRequireFallback` for why that farm cannot be relied
// on.
import Module, { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
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

/** The CommonJS resolver entry point, which `@types/node` does not declare. */
interface ResolveFilenameHost {
  _resolveFilename: (request: string, parent: unknown, ...rest: unknown[]) => string
}

/**
 * Let a CommonJS resolution that found nothing fall back to the installation's
 * own `node_modules`.
 *
 * dsh resolves package metadata with `createRequire()` against the composed
 * tree's base, which is the profile directory, and gets to the in-box packages
 * through the symlink farm in `<dsh home>/profiles/node_modules`. Those links
 * are real filesystem symlinks, so they only work while the installation's
 * packages are real directories: point the app at an asar archive and every one
 * of them dangles, because the OS cannot walk into a file. The caller that
 * matters — `dsh-client-modules` — treats a resolution failure as "not a client
 * package" and caches it, so the whole web UI composes to nothing without one
 * error anywhere. Answering from the installation here removes the dependency
 * on a mechanism the packaging format gets a vote in.
 *
 * Deliberately only a fallback: it runs after normal resolution has already
 * failed, so it can never shadow a package the profile legitimately provides.
 *
 * @param appRoot - the application root whose package.json anchors the
 *   installation's `node_modules` (an asar path is fine; Node reads it through
 *   Electron's archive layer, which is the whole point).
 * @returns an idempotent disposer restoring the original resolver.
 */
export function installInstallationRequireFallback(appRoot: string): () => void {
  const host = Module as unknown as ResolveFilenameHost
  const installation = createRequire(join(appRoot, 'package.json'))
  const original = host._resolveFilename

  host._resolveFilename = function resolveFilename(request, parent, ...rest) {
    try {
      return original.call(this, request, parent, ...rest)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw cause
      if (!isBareSpecifier(request)) throw cause
      try {
        return installation.resolve(request)
      } catch {
        // The installation does not have it either: the first failure is the
        // honest one to report.
        throw cause
      }
    }
  }

  let active = true
  return () => {
    if (!active) return
    active = false
    host._resolveFilename = original
  }
}
