import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expandEnvVars, launchApp, loadAppRegistry, resolveApp } from '../apps'

function tempAppsFile(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-apps-'))
  const file = join(dir, 'apps.json')
  if (content !== undefined) writeFileSync(file, content)
  return file
}

afterEach(() => vi.unstubAllEnvs())

describe('loadAppRegistry', () => {
  it('seeds apps.json with Windows defaults on first run', () => {
    const file = tempAppsFile()
    vi.stubEnv('JARVIS_APPS_PATH', file)
    const registry = loadAppRegistry()

    expect(existsSync(file)).toBe(true)
    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(Array.isArray(written.apps)).toBe(true)
    expect(registry.map((a) => a.id)).toContain('discord')
    expect(registry.map((a) => a.id)).toContain('chrome')
  })

  it('loads valid user definitions and skips invalid ones', () => {
    const file = tempAppsFile(
      JSON.stringify({
        apps: [
          { id: 'good', name: 'Good App', aliases: ['good'], candidates: ['/bin/true'] },
          { id: 'bad-no-candidates', name: 'Bad', aliases: [], candidates: [] },
          { name: 'missing id', candidates: ['/x'] },
          'not even an object'
        ]
      })
    )
    vi.stubEnv('JARVIS_APPS_PATH', file)
    const registry = loadAppRegistry()
    expect(registry).toHaveLength(1)
    expect(registry[0].id).toBe('good')
  })

  it('routes generic browser aliases to Edge in the seeded defaults', () => {
    vi.stubEnv('JARVIS_APPS_PATH', tempAppsFile())
    const registry = loadAppRegistry()

    // Edge precedes Chrome so "my browser" works on machines without Chrome;
    // the Chrome entry itself stays intact for machines that have it.
    expect(registry.findIndex((a) => a.id === 'edge')).toBeLessThan(
      registry.findIndex((a) => a.id === 'chrome')
    )
    for (const phrase of ['my browser', 'browser', 'the browser', 'web browser', 'edge']) {
      expect(resolveApp(phrase)?.id).toBe('edge')
    }
    expect(resolveApp('chrome')?.id).toBe('chrome')
    expect(resolveApp('google chrome')?.id).toBe('chrome')

    const edge = registry.find((a) => a.id === 'edge')!
    expect(edge.candidates.length).toBeGreaterThanOrEqual(3)
    expect(edge.candidates).toContain(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    )
  })

  it('treats a malformed file as an empty registry without crashing', () => {
    vi.stubEnv('JARVIS_APPS_PATH', tempAppsFile('{broken json'))
    expect(loadAppRegistry()).toEqual([])
  })

  it('never writes to disk when no location is registered', () => {
    const registry = loadAppRegistry()
    expect(registry.length).toBeGreaterThan(0)
    expect(existsSync(join(process.cwd(), 'apps.json'))).toBe(false)
  })
})

describe('expandEnvVars', () => {
  it('expands %VAR% patterns', () => {
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\Test\\AppData\\Local')
    expect(expandEnvVars('%LOCALAPPDATA%\\Discord\\Update.exe')).toBe(
      'C:\\Users\\Test\\AppData\\Local\\Discord\\Update.exe'
    )
  })

  it('leaves unknown variables intact', () => {
    expect(expandEnvVars('%DEFINITELY_NOT_SET_XYZ%\\x')).toBe('%DEFINITELY_NOT_SET_XYZ%\\x')
  })
})

describe('resolveApp', () => {
  const file = tempAppsFile(
    JSON.stringify({
      apps: [
        { id: 'discord', name: 'Discord', aliases: ['discord'], candidates: ['/x'] },
        {
          id: 'chrome',
          name: 'Google Chrome',
          aliases: ['chrome', 'my browser'],
          candidates: ['/y']
        }
      ]
    })
  )

  it('matches id, name, alias, and phrases containing an alias', () => {
    vi.stubEnv('JARVIS_APPS_PATH', file)
    expect(resolveApp('discord')?.id).toBe('discord')
    expect(resolveApp('Google Chrome')?.id).toBe('chrome')
    expect(resolveApp('MY BROWSER')?.id).toBe('chrome')
    expect(resolveApp('open discord please')?.id).toBe('discord')
  })

  it('returns null for unknown apps and empty targets', () => {
    vi.stubEnv('JARVIS_APPS_PATH', file)
    expect(resolveApp('photoshop')).toBeNull()
    expect(resolveApp('')).toBeNull()
    expect(resolveApp(undefined)).toBeNull()
  })
})

describe('launchApp', () => {
  it('fails readably when no candidate path exists', async () => {
    const result = await launchApp({
      id: 'ghost',
      name: 'Ghost App',
      aliases: [],
      candidates: ['/definitely/not/here.exe', '%NOPE%\\also-missing.exe']
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Ghost App could not be opened')
    expect(result.message).toContain('path was not found')
  })

  it('spawns a real detached process and reports success', async () => {
    const result = await launchApp({
      id: 'node',
      name: 'Node Probe',
      aliases: [],
      candidates: [process.execPath],
      args: ['-e', 'setTimeout(() => {}, 50)']
    })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('launched')
  })

  it('reports a spawn failure honestly (existing but non-executable file)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-noexec-'))
    const file = join(dir, 'not-executable.txt')
    writeFileSync(file, 'just text')
    const result = await launchApp({
      id: 'noexec',
      name: 'NoExec',
      aliases: [],
      candidates: [file]
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('failed to start')
  })
})
