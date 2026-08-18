import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { spawn } from 'child_process'
import { dirname, join } from 'path'

// User-editable application registry stored in userData/apps.json, seeded
// with sensible Windows defaults on first run. Launching is strictly
// allowlisted: only apps from this file can be started, every candidate path
// is checked with existsSync before spawn, and processes are detached and
// unref()'d so they outlive JARVIS. Nothing here ever executes a shell or a
// model-provided path.

export interface AppDefinition {
  id: string
  name: string
  aliases: string[]
  /** Candidate executable paths; the first that exists is used. %VARS% expand. */
  candidates: string[]
  args?: string[]
}

export interface ActionResult {
  ok: boolean
  message: string
}

// Seeded defaults for a typical Windows machine. Users edit apps.json to
// match their setup; missing apps fail with a readable message, never a crash.
const WINDOWS_DEFAULTS: AppDefinition[] = [
  {
    id: 'discord',
    name: 'Discord',
    aliases: ['discord'],
    candidates: ['%LOCALAPPDATA%\\Discord\\Update.exe'],
    args: ['--processStart', 'Discord.exe']
  },
  {
    id: 'chrome',
    name: 'Google Chrome',
    aliases: ['chrome', 'google chrome', 'browser', 'my browser', 'the browser', 'web browser'],
    candidates: [
      '%PROGRAMFILES%\\Google\\Chrome\\Application\\chrome.exe',
      '%PROGRAMFILES(X86)%\\Google\\Chrome\\Application\\chrome.exe',
      '%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe'
    ]
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    aliases: ['edge', 'microsoft edge'],
    candidates: ['%PROGRAMFILES(X86)%\\Microsoft\\Edge\\Application\\msedge.exe']
  },
  {
    id: 'spotify',
    name: 'Spotify',
    aliases: ['spotify'],
    candidates: ['%APPDATA%\\Spotify\\Spotify.exe']
  },
  {
    id: 'steam',
    name: 'Steam',
    aliases: ['steam'],
    candidates: ['%PROGRAMFILES(X86)%\\Steam\\steam.exe', '%PROGRAMFILES%\\Steam\\steam.exe']
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    aliases: ['vs code', 'vscode', 'visual studio code', 'code'],
    candidates: ['%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe']
  },
  {
    id: 'notepad',
    name: 'Notepad',
    aliases: ['notepad'],
    candidates: ['%WINDIR%\\notepad.exe', 'C:\\Windows\\notepad.exe']
  }
]

let appsDir: string | null = null

/** Called from the main process with app.getPath('userData'). */
export function registerAppsDir(dir: string): void {
  appsDir = dir
}

function appsFilePath(): string {
  return process.env.JARVIS_APPS_PATH || join(appsDir ?? process.cwd(), 'apps.json')
}

export function expandEnvVars(path: string): string {
  return path.replace(/%([^%]+)%/g, (match, name: string) => {
    const value =
      process.env[name] ??
      process.env[name.toUpperCase()] ??
      // Node exposes "ProgramFiles(x86)" with this exact casing on Windows
      process.env[name.replace(/\(X86\)/i, '(x86)')]
    return value ?? match
  })
}

function parseDefinition(value: unknown): AppDefinition | null {
  if (typeof value !== 'object' || value === null) return null
  const { id, name, aliases, candidates, args } = value as Record<string, unknown>
  if (typeof id !== 'string' || typeof name !== 'string') return null
  if (!Array.isArray(candidates) || !candidates.every((c) => typeof c === 'string')) return null
  if (candidates.length === 0) return null
  const def: AppDefinition = {
    id,
    name,
    aliases: Array.isArray(aliases) ? aliases.filter((a) => typeof a === 'string') : [],
    candidates
  }
  if (Array.isArray(args) && args.every((a) => typeof a === 'string')) def.args = args
  return def
}

/**
 * Loads the registry, seeding the file with Windows defaults on first run.
 * A malformed file yields an empty registry (with a console warning), never
 * a crash — and is left untouched for the user to repair.
 */
export function loadAppRegistry(): AppDefinition[] {
  // Without an explicit location (main-process userData or JARVIS_APPS_PATH)
  // never write to disk — just serve the defaults.
  if (!process.env.JARVIS_APPS_PATH && !appsDir) return WINDOWS_DEFAULTS

  const file = appsFilePath()
  if (!existsSync(file)) {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify({ apps: WINDOWS_DEFAULTS }, null, 2))
    } catch (error) {
      console.error('[control] could not seed apps.json', error)
      return WINDOWS_DEFAULTS
    }
  }

  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { apps?: unknown[] }
    if (!Array.isArray(raw.apps)) throw new Error('missing apps array')
    const apps: AppDefinition[] = []
    for (const entry of raw.apps) {
      const def = parseDefinition(entry)
      if (def) apps.push(def)
      else console.error('[control] skipping invalid app definition', entry)
    }
    return apps
  } catch (error) {
    console.error('[control] apps.json is malformed; no apps available until repaired', error)
    return []
  }
}

function wholeWordMatch(haystack: string, needle: string): boolean {
  if (needle.length < 3) return false
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack)
}

export function resolveApp(target: string | undefined): AppDefinition | null {
  if (!target) return null
  const normalized = target.trim().toLowerCase()
  if (!normalized) return null
  const registry = loadAppRegistry()
  return (
    registry.find(
      (app) =>
        app.id === normalized ||
        app.name.toLowerCase() === normalized ||
        app.aliases.some((alias) => alias.toLowerCase() === normalized)
    ) ??
    registry.find(
      (app) =>
        wholeWordMatch(normalized, app.id) ||
        app.aliases.some((alias) => wholeWordMatch(normalized, alias.toLowerCase()))
    ) ??
    null
  )
}

export async function launchApp(def: AppDefinition): Promise<ActionResult> {
  const resolved = def.candidates.map(expandEnvVars)
  const executable = resolved.find((candidate) => existsSync(candidate))
  if (!executable) {
    return {
      ok: false,
      message:
        `${def.name} could not be opened because the configured application path was not ` +
        'found. Check its entry in apps.json.'
    }
  }

  return new Promise((resolve) => {
    try {
      const child = spawn(executable, def.args ?? [], {
        detached: true,
        stdio: 'ignore'
      })
      child.once('spawn', () => {
        child.unref() // keep the app alive after JARVIS exits
        resolve({ ok: true, message: `${def.name} launched.` })
      })
      child.once('error', (error) => {
        console.error(`[control] spawn failed for ${def.id}`, error)
        resolve({ ok: false, message: `${def.name} failed to start on this system.` })
      })
    } catch (error) {
      console.error(`[control] spawn threw for ${def.id}`, error)
      resolve({ ok: false, message: `${def.name} failed to start on this system.` })
    }
  })
}

/** Names for the model's awareness of what it may open. */
export function listAppNames(): string[] {
  return loadAppRegistry().map((app) => app.name)
}
