import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inspectPackage } from './package-inspect'

let packageDir: string

function writeManifest(manifest: object): void {
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify(manifest, undefined, 2))
}

function writeSource(relativePath: string, source: string): void {
  const full = join(packageDir, relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, source)
}

beforeEach(() => {
  packageDir = mkdtempSync(join(tmpdir(), 'harness-inspect-'))
  writeManifest({ name: 'dsh-plugin-sample', version: '1.0.0' })
})
afterEach(() => {
  rmSync(packageDir, { recursive: true, force: true })
})

describe('inspectPackage', () => {
  it('returns an empty inspection for a package that is not there', () => {
    const result = inspectPackage(join(packageDir, 'missing'))
    expect(result).toEqual({ installScripts: [], capabilities: [], filesScanned: 0, truncated: false })
  })

  it('reports lifecycle hooks that would run at install time', () => {
    writeManifest({ name: 'p', scripts: { preinstall: 'a', postinstall: 'b', build: 'tsc' } })
    expect(inspectPackage(packageDir).installScripts).toEqual(['preinstall', 'postinstall'])
  })

  it('does not report prepare, which never runs for a published tarball', () => {
    writeManifest({ name: 'p', scripts: { prepare: 'tsc' } })
    expect(inspectPackage(packageDir).installScripts).toEqual([])
  })

  it('reports the capabilities the shipped code reaches for', () => {
    writeSource('lib/index.js', `
      import { spawn } from 'node:child_process'
      export async function run() {
        await fetch('https://example.com')
        spawn('sh', ['-c', 'ls'])
      }
    `)
    const result = inspectPackage(packageDir)
    expect(result.capabilities).toContain('process-spawn')
    expect(result.capabilities).toContain('network')
    expect(result.filesScanned).toBe(1)
  })

  it('reports dynamic code and environment access', () => {
    writeSource('lib/x.js', 'const f = new Function("return 1"); const k = process.env.SECRET')
    const result = inspectPackage(packageDir)
    expect(result.capabilities).toContain('dynamic-code')
    expect(result.capabilities).toContain('environment')
  })

  it('reports nothing for a package that only builds UI', () => {
    writeSource('lib/ui.js', 'export const Panel = () => null')
    expect(inspectPackage(packageDir).capabilities).toEqual([])
  })

  it('skips node_modules and test directories', () => {
    writeSource('node_modules/dep/index.js', "require('child_process')")
    writeSource('test/spec.js', "require('child_process')")
    writeSource('lib/index.js', 'export const x = 1')
    const result = inspectPackage(packageDir)
    expect(result.capabilities).toEqual([])
    expect(result.filesScanned).toBe(1)
  })

  it('only scans code files', () => {
    writeSource('README.md', 'this mentions child_process in prose')
    writeSource('lib/index.js', 'export const x = 1')
    expect(inspectPackage(packageDir).capabilities).toEqual([])
  })

  it('survives an unreadable manifest', () => {
    writeFileSync(join(packageDir, 'package.json'), '{ not json')
    expect(inspectPackage(packageDir).installScripts).toEqual([])
  })
})
