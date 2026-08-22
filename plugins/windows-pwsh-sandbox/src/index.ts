// Electron adapter for the upstream Windows ACL PowerShell executor. The
// upstream sandbox confines every pwsh call into `process.execPath <runner.js>
// ...` — a plain Node launch on the CLI, but inside Electron that spawns a
// second app instance (killed by the single-instance lock, or worse), so tool
// calls return empty results without executing. This subclass rewrites exactly
// that launch through a run-as-node trampoline and pins pwsh to well-known
// install paths. Approach adapted from anywhere-labs/deepseek-harness-desktop
// (MIT, Anywhere Labs); see THIRD_PARTY_NOTICES.md.
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { SandboxPwshExecutor } from '@deepseek-ai/dsh-pwsh-sandbox'
import type { Config } from '@deepseek-ai/dsh-pwsh-local'

const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
const UPSTREAM_RUNNER = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner'))
const TRAMPOLINE = fileURLToPath(new URL('./trampoline.mjs', import.meta.url))

/** Well-known Windows PowerShell paths, so the sandbox never runs a PATH-provided portable pwsh. */
function pinnedPwshPath(env: NodeJS.ProcessEnv): string | undefined {
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
  const systemRoot = env.SystemRoot ?? 'C:\\Windows'
  const candidates = [
    win32.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
    win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ]
  return candidates.find(candidate => existsSync(candidate))
}

function withPinnedPwsh(config: Config): Config {
  if (config.pwshPath !== undefined && config.pwshPath.length > 0) return config
  const pwshPath = pinnedPwshPath(process.env)
  return pwshPath === undefined ? config : { ...config, pwshPath }
}

/** Rewrite an exact upstream ACL-runner launch into a trampolined run-as-node launch. */
function adapt(
  spec: ShellExecSpec,
  argv: readonly string[],
): { spec: ShellExecSpec; argv: readonly string[] } {
  const [program, runner, ...args] = argv
  if (process.platform !== 'win32'
    || process.versions.electron === undefined
    || program !== process.execPath
    || runner !== UPSTREAM_RUNNER) {
    return { spec, argv }
  }
  const env = { ...spec.env }
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === RUN_AS_NODE) delete env[key]
  }
  env[RUN_AS_NODE] = '1'
  return {
    spec: { ...spec, env },
    argv: [process.execPath, TRAMPOLINE, UPSTREAM_RUNNER, ...args],
  }
}

export class DesktopWindowsPwshSandbox extends SandboxPwshExecutor {
  constructor(ctx: ConstructorParameters<typeof SandboxPwshExecutor>[0], config: Config) {
    super(ctx, withPinnedPwsh(config))
  }

  protected override async runArgv(spec: ShellExecSpec, argv: readonly string[]): Promise<ShellRunResult> {
    const adapted = adapt(spec, argv)
    return super.runArgv(adapted.spec, adapted.argv)
  }

  protected override startArgv(spec: ShellExecSpec, argv: readonly string[]): ShellProcess {
    const adapted = adapt(spec, argv)
    return super.startArgv(adapted.spec, adapted.argv)
  }
}

export default DesktopWindowsPwshSandbox
