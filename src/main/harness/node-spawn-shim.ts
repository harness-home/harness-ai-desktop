// dsh spawns Node worker children via `process.execPath` (win32 folder-dialog
// worker, browser opener). Inside Electron that path is the app binary, so the
// child would start a second app instance and die on the single-instance lock.
// ELECTRON_RUN_AS_NODE turns exactly those children into plain Node processes;
// injecting it at the child_process seam keeps the fix in the shell (no dsh
// modification) and touches only self-exec spawns.
import childProcess from 'node:child_process'

export function installNodeSpawnShim(): void {
  const original = childProcess.spawn.bind(childProcess)
  const patched = (
    command: string,
    argsOrOptions?: readonly string[] | childProcess.SpawnOptions,
    maybeOptions?: childProcess.SpawnOptions,
  ): childProcess.ChildProcess => {
    const args = Array.isArray(argsOrOptions) ? argsOrOptions : []
    let options = (Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions) as childProcess.SpawnOptions | undefined
    if (command === process.execPath) {
      const env = { ...(options?.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' }
      options = { ...options, env }
    }
    return original(command, [...args], options ?? {})
  }
  childProcess.spawn = patched as typeof childProcess.spawn
}
