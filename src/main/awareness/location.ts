import { WEATHER_LOCATIONS } from '../weather'

// Location awareness — explicit and privacy-conscious. The current location
// comes only from JARVIS_LOCATION in .env; there is no IP geolocation, no
// device tracking, and nothing is collected silently. When it matches one of
// the supported weather locations, "here" questions can use live weather.

export interface LocationInfo {
  configured: boolean
  name?: string
  /** id into WEATHER_LOCATIONS when the location has live weather support */
  weatherLocationId?: string
  weatherLabel?: string
}

// Accepted spellings per supported weather location.
const LOCATION_ALIASES: Record<string, string[]> = {
  sistranda: ['sistranda', 'frøya', 'froya', 'frøya kommune'],
  trondheim: ['trondheim', 'trondhjem']
}

export function resolveLocation(raw: string | undefined): LocationInfo {
  const name = raw?.trim()
  if (!name) return { configured: false }

  const normalized = name.toLowerCase()
  for (const location of WEATHER_LOCATIONS) {
    const aliases = LOCATION_ALIASES[location.id] ?? [location.id]
    if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) {
      return {
        configured: true,
        name,
        weatherLocationId: location.id,
        weatherLabel: location.label
      }
    }
  }
  // Configured but outside live-weather coverage — never invent weather for it.
  return { configured: true, name }
}

export function getLocationInfo(): LocationInfo {
  return resolveLocation(process.env.JARVIS_LOCATION)
}

export function formatLocationContext(info: LocationInfo = getLocationInfo()): string {
  if (!info.configured) {
    return (
      'Location: not configured. If asked where the user is or about the weather "here", say ' +
      "you don't currently have their location — never guess it."
    )
  }
  if (info.weatherLocationId) {
    return (
      `Location: the user's configured current location is ${info.name} — live weather for it ` +
      `is the "${info.weatherLabel}" entry in the weather feed; "here" refers to this location.`
    )
  }
  return (
    `Location: the user's configured current location is ${info.name}. There is no live ` +
    'weather coverage for it — never invent current conditions there.'
  )
}
