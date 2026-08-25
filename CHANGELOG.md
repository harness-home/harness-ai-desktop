# Changelog

All notable changes to the Harness AI desktop client are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) —
with the caveat that this is a developer preview tracking a runtime that states
breaking changes are expected, so treat `0.x` minor bumps as potentially
breaking and upgrade the clients and the service together.

## [0.1.6] — 2026-08-25

### Added

- **`harness-ai.config.json`, beside the executable.** Settings that belong to a
  network rather than to a person can now be corrected on an installed machine
  instead of in a new build. The first of them is `pluginRegistry`: where the
  public npm registry is slow or unreachable, the plugin market can be pointed
  at a mirror of it. The integrity re-check reads from the same registry the
  tarball comes from, so a mirror serving different bytes than the catalog
  recorded is still refused. A malformed file falls back to the defaults and
  says why in the log; `HARNESS_PLUGIN_REGISTRY` overrides it for one run.

### Changed

- **Installation takes 12 seconds instead of 299**, because the application is
  packaged as an asar archive: 105 files land on disk instead of 19,691. The
  bytes are the same — install cost is paid per file, to the installer creating
  each one and to the virus scanner reading it — which is also why the first
  launch after installing dropped from 39 s to 3 s. Native modules and anything
  spawned as a process (`rg.exe`, `OpenConsole.exe`) stay unpacked beside the
  archive, and the packaging gate now verifies that rather than assuming it.
- **Source maps and type declarations are no longer packaged** — 7,285 of the
  19,691 files an install used to write, and nothing in a packaged client reads
  either one; only a debugger and a compiler do, and neither is present in an
  installed app. On its own that took the install from 299 s to 210 s, which is
  what asar was then applied on top of. The 53 unused Chromium language packs
  are gone too (this client ships two UI languages), worth 45 MB and, measurably,
  no time at all. The download is 139.8 MB → 115.0 MB.

### Fixed

- **CommonJS module resolution no longer depends on a symlink farm.** The
  runtime reads package metadata with `createRequire()` against the composed
  tree's base — the profile directory — and reached the installed packages only
  through symlinks that `dsh-app-boot` writes under the dsh home. Those links
  point at whichever build started last, so moving the installation, or having
  more than one build, left them dangling; resolution then failed, the caller
  treated the failure as "this is not a client package" and cached it, and the
  whole web UI composed to nothing without a single error in the log. Resolution
  now falls back to the installation's own `node_modules` after a genuine
  failure, which is also what let asar be turned on at all.

## [0.1.5] — 2026-08-25

First public release, covering everything built since the shell was scaffolded.
Windows x64 only, and the installer is **not code-signed** — SmartScreen will
warn on first run; the release notes carry the SHA-256 to check against.

### Added

- **The DeepSeek Harness runtime, hosted in-process.** A desktop profile is
  composed from the official bundle layers and the `dsh` Host boots inside the
  Electron main process — no child runtime, no second Node installation. It
  binds `127.0.0.1:43110`, moving to the next free port if that one is taken.
- **The upstream Web UI, embedded**, with navigation locked to loopback and our
  own features layered on as Cordis plugins: brand and themes, the account
  panel, the plugin market panel, a native workspace picker, and a Windows ACL
  PowerShell sandbox runner.
- **Account and device identity.** Sign-in from inside the app, tokens in secure
  storage, device facts surfaced in the account dialog, revocable server-side.
- **Hosted sessions.** Local session events mirror to `harness-ai-server` over
  an outbound device link, so the same conversation can be read and continued
  from the mobile client. Credential-shaped strings are masked before upload and
  sessions whose working directory hits the denylist are never synced.
- **Attachment sync.** Images the agent produced are content-addressed, uploaded
  on a channel of their own behind the events, deduplicated per account and
  capped by a server-side quota.
- **Remote control.** Questions and approvals bridge to the hosting link, and
  remote create-session commands are honoured, so work can be settled from a
  phone.
- **The plugin market**, read-only catalog through the loopback bridge, with
  install and removal into the profile, provenance, downloads, license and an
  installable filter.
- **A supply-chain gate in front of every install** — the runtime's permissions
  govern tool calls, not the code a plugin ships. Risk flags on each entry, a
  disclosure gate that states a plugin runs with the same access as the client,
  an integrity re-check against the registry before anything is written,
  `--ignore-scripts` written explicitly, a capability report afterwards, and an
  install journal that restores the profile manifest after a failure or crash.
- **`harness-ai://` deep links**, so the website can hand over a catalog id —
  never a package name and version — for the client to resolve and confirm.
- **Application updates** with a tray entry, never installed behind your back.
- **Reliability surfaces**: single-instance lock, crash evidence collected from
  the previous run, named startup stages that report which one failed, a
  recovery page offering retry / open logs / quit, secret-masked file logs, and
  a system tray with tray-resident lifecycle.
- **Packaging**: an NSIS Windows target behind an `afterPack` gate that verifies
  the packaged tree and the full runtime module closure, plus a license
  allowlist gate that generates `THIRD_PARTY_NOTICES.md`.
- **Localization** groundwork for `zh-CN` and `en-US`.

### Changed

- The startup health gate measures **progress** rather than wall-clock time —
  20 s without progress, 180 s absolute — after a flat timeout proved impossible
  to set correctly: every value that was long enough for a slow machine was also
  long enough to make a real hang feel like a hang.
- The update feed host is a sentinel on the reserved `.invalid` TLD until the
  distribution location is decided, so no shipped client ever fetches a domain
  the project does not own.

### Fixed

- **Two upstream code paths spawned Node through `process.execPath`**, which
  under Electron means a second copy of the application: the native
  directory-picker worker (fixed with a `child_process` shim) and the Windows
  ACL PowerShell sandbox runner (fixed with a trampoline). Symptom was empty
  output or timeouts from pwsh tools.
- A broken profile plugin could block startup; it is now quarantined instead,
  and the quarantine record survives a refused re-enable.
- Packaging shipped an incomplete runtime closure: `dsh` packages declare their
  siblings as peer dependencies and electron-builder walks only `dependencies`,
  so the app booted from the repository and failed from a real install.
- Portals did not unmount and dialogs would not close, because plugins each
  carried their own React DOM copy.
- Hosting sync could wedge, and server-side gaps went unrepaired.

### Build

- The shared wire contracts come from npm as
  [`@harness-ai/contracts`](https://www.npmjs.com/package/@harness-ai/contracts)
  instead of a filesystem link to a sibling checkout, so a plain clone installs
  and builds.
- Every `@deepseek-ai/*` package is pinned through a pnpm catalog, so an
  upstream upgrade is a one-line change rather than an edit across thirty
  dependency entries.
- GitHub Actions run typecheck, the unit suite and a production build on Windows
  for every change, and build the installer from a `v*` tag.
- A plugin `.gitignore` pattern was excluding `src/client/lib/` — source, not
  build output — so two files had never been committed and a fresh clone could
  not typecheck.

[0.1.6]: https://github.com/harness-home/harness-ai-desktop/releases/tag/v0.1.6
[0.1.5]: https://github.com/harness-home/harness-ai-desktop/releases/tag/v0.1.5
