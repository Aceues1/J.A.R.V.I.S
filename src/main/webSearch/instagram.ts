// Specialized source — Instagram follower counts via i.instagram.com, per
// the guide. Only clearly identifiable follower-count queries route here;
// we never scrape arbitrary Instagram pages, and only the public follower
// count is extracted. A refusal (401/403/429 are common) is reported
// honestly instead of being papered over.

import { CHROME_UA, WebSearchError } from './types'

const DEFAULT_BASE_URL = 'https://i.instagram.com'
const REQUEST_TIMEOUT_MS = 10_000
// Public web app id Instagram's own web client sends; required or the
// endpoint returns nothing useful.
const IG_APP_ID = '936619743392459'

/**
 * Detect "how many followers does <user> have on instagram" style queries.
 * Conservative: requires both "followers" and an Instagram mention, plus an
 * extractable username; anything else falls back to general search.
 */
export function detectInstagramQuery(text: string): string | null {
  const q = text.toLowerCase()
  if (!/\bfollowers?\b/.test(q)) return null
  if (!/\binstagram\b|\binsta\b|\big\b/.test(q)) return null
  const patterns = [
    /followers?\s+(?:does|do|of|for|has)\s+@?([a-z0-9._]{2,30})/i,
    /@?([a-z0-9._]{2,30})(?:'s)?\s+(?:instagram\s+|insta\s+|ig\s+)?followers?/i,
    /@([a-z0-9._]{2,30})/i
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const candidate = match?.[1]?.toLowerCase()
    if (candidate && !/^(instagram|insta|ig|many|much|the|have|has|does)$/.test(candidate)) {
      return candidate
    }
  }
  return null
}

export interface InstagramFollowers {
  username: string
  followers: number
}

export async function fetchInstagramFollowers(username: string): Promise<InstagramFollowers> {
  const baseUrl = process.env.INSTAGRAM_BASE_URL || DEFAULT_BASE_URL
  const url = `${baseUrl}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': CHROME_UA,
        'Cache-Control': 'no-cache',
        Accept: 'application/json',
        'X-IG-App-ID': IG_APP_ID
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      console.error('[websearch:instagram] timed out')
      throw new WebSearchError('The Instagram lookup timed out.')
    }
    console.error('[websearch:instagram] network error', error)
    throw new WebSearchError('Instagram could not be reached.')
  }

  if (!response.ok) {
    console.error('[websearch:instagram] HTTP', response.status)
    throw new WebSearchError(
      `Instagram declined the request (status ${response.status}) — follower data is unavailable.`
    )
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    console.error('[websearch:instagram] invalid JSON', error)
    throw new WebSearchError('Instagram returned an unreadable response.')
  }

  const followers = (data as { data?: { user?: { edge_followed_by?: { count?: unknown } } } })?.data
    ?.user?.edge_followed_by?.count
  if (typeof followers !== 'number' || !Number.isFinite(followers)) {
    console.error('[websearch:instagram] unexpected response shape')
    throw new WebSearchError('Instagram returned an unexpected response.')
  }
  return { username, followers }
}
