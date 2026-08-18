import type { ActionResult } from './apps'

// Allowlisted website launcher. URLs open through the system's default
// browser (shell.openExternal, injected from the main process so this module
// stays testable). The model can only name entries from this registry or
// pass an https URL whose hostname is explicitly allowlisted — arbitrary
// model-invented URLs never open.

export interface WebsiteDefinition {
  id: string
  name: string
  aliases: string[]
  url: string
}

const WEBSITES: WebsiteDefinition[] = [
  {
    id: 'google',
    name: 'Google',
    aliases: ['google', 'the web', 'web', 'browse'],
    url: 'https://www.google.com'
  },
  {
    id: 'youtube',
    name: 'YouTube',
    aliases: ['youtube', 'you tube'],
    url: 'https://www.youtube.com'
  },
  {
    id: 'instagram',
    name: 'Instagram',
    aliases: ['instagram', 'insta'],
    url: 'https://www.instagram.com'
  },
  {
    id: 'gmail',
    name: 'Gmail',
    aliases: ['gmail', 'my email', 'email'],
    url: 'https://mail.google.com'
  },
  { id: 'github', name: 'GitHub', aliases: ['github', 'git hub'], url: 'https://github.com' },
  { id: 'reddit', name: 'Reddit', aliases: ['reddit'], url: 'https://www.reddit.com' },
  { id: 'x', name: 'X', aliases: ['x', 'twitter'], url: 'https://x.com' },
  { id: 'twitch', name: 'Twitch', aliases: ['twitch'], url: 'https://www.twitch.tv' },
  { id: 'netflix', name: 'Netflix', aliases: ['netflix'], url: 'https://www.netflix.com' },
  { id: 'finn', name: 'Finn', aliases: ['finn', 'finn.no'], url: 'https://www.finn.no' },
  { id: 'vg', name: 'VG', aliases: ['vg', 'vg.no'], url: 'https://www.vg.no' },
  {
    id: 'steam-store',
    name: 'Steam Store',
    aliases: ['steam store', 'steam website'],
    url: 'https://store.steampowered.com'
  },
  // Deep links — direct "create" shortcuts, per the guide
  {
    id: 'new-google-doc',
    name: 'a new Google Doc',
    aliases: ['new google doc', 'new doc', 'new document', 'google doc'],
    url: 'https://docs.google.com/document/create'
  },
  {
    id: 'new-google-sheet',
    name: 'a new Google Sheet',
    aliases: ['new google sheet', 'new sheet', 'new spreadsheet', 'google sheet'],
    url: 'https://docs.google.com/spreadsheets/create'
  },
  {
    id: 'new-google-slide',
    name: 'a new Google Slides deck',
    aliases: ['new google slides', 'new presentation', 'new slides'],
    url: 'https://docs.google.com/presentation/create'
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    aliases: ['maps', 'google maps'],
    url: 'https://www.google.com/maps'
  }
]

// Raw https URLs from the model are accepted only for these hostnames.
const ALLOWED_HOSTNAMES = new Set(
  WEBSITES.map((site) => new URL(site.url).hostname).concat([
    'docs.google.com',
    'www.google.com',
    'google.com',
    'youtube.com',
    'github.com'
  ])
)

function containsWholeAlias(haystack: string, alias: string): boolean {
  // Fuzzy matching needs whole-word hits and a minimum length: the alias "x"
  // must never match "example.com".
  if (alias.length < 3) return false
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack)
}

export function resolveWebsite(target: string | undefined): WebsiteDefinition | null {
  if (!target) return null
  const normalized = target.trim().toLowerCase()
  if (!normalized) return null

  // An explicit URL is decided first, and only when https + allowlisted host.
  if (/^https?:\/\/|^[a-z]+:/i.test(normalized)) {
    try {
      const url = new URL(target.trim())
      if (url.protocol === 'https:' && ALLOWED_HOSTNAMES.has(url.hostname)) {
        return { id: 'url', name: url.hostname, aliases: [], url: url.toString() }
      }
    } catch {
      return null
    }
    return null
  }

  return (
    WEBSITES.find(
      (site) =>
        site.id === normalized ||
        site.name.toLowerCase() === normalized ||
        site.aliases.some((alias) => alias === normalized)
    ) ??
    WEBSITES.find((site) => site.aliases.some((alias) => containsWholeAlias(normalized, alias))) ??
    null
  )
}

type ExternalOpener = (url: string) => Promise<void>

let openExternal: ExternalOpener | null = null

/** Called from the main process with shell.openExternal. */
export function registerExternalOpener(opener: ExternalOpener): void {
  openExternal = opener
}

export async function openWebsite(site: WebsiteDefinition): Promise<ActionResult> {
  if (!openExternal) {
    return { ok: false, message: 'The browser launcher is not available.' }
  }
  try {
    await openExternal(site.url)
    return { ok: true, message: `${site.name} opened in the browser.` }
  } catch (error) {
    console.error(`[control] openExternal failed for ${site.id}`, error)
    return { ok: false, message: `${site.name} could not be opened in the browser.` }
  }
}

/** Names for the model's awareness of what it may open. */
export function listWebsiteNames(): string[] {
  return WEBSITES.filter((site) => !site.id.startsWith('new-')).map((site) => site.name)
}
