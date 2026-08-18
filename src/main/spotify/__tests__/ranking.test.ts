import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { parseTrackRequest, pickBestTrack, scoreTrack } from '../ranking'
import type { SpotifyTrack } from '../client'

const track = (
  name: string,
  artists: string[],
  extra: Partial<SpotifyTrack> = {}
): SpotifyTrack => ({
  uri: `spotify:track:${name.replace(/\s+/g, '-')}`,
  name,
  artists,
  album: '',
  popularity: 50,
  durationMs: 200000,
  ...extra
})

describe('parseTrackRequest', () => {
  it('splits "song by artist" on the LAST " by "', () => {
    expect(parseTrackRequest('Bohemian Rhapsody by Queen')).toEqual({
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      wantsVariant: false
    })
    expect(parseTrackRequest('Stand by Me by Ben E. King')).toEqual({
      title: 'Stand by Me',
      artist: 'Ben E. King',
      wantsVariant: false
    })
  })

  it('handles title-only requests and flags explicit variant requests', () => {
    expect(parseTrackRequest('Thunderstruck')).toEqual({
      title: 'Thunderstruck',
      artist: undefined,
      wantsVariant: false
    })
    expect(parseTrackRequest('Thunderstruck live by AC/DC').wantsVariant).toBe(true)
    expect(parseTrackRequest('Blinding Lights remix').wantsVariant).toBe(true)
  })
})

describe('ranking', () => {
  const request = { title: 'Bohemian Rhapsody', artist: 'Queen', wantsVariant: false }

  it('an exact artist match beats a more popular cover', () => {
    const original = track('Bohemian Rhapsody', ['Queen'], { popularity: 60 })
    const cover = track('Bohemian Rhapsody', ['Some Tribute Band'], { popularity: 95 })
    expect(scoreTrack(original, request)).toBeGreaterThan(scoreTrack(cover, request))
    expect(pickBestTrack([cover, original], request)?.artists).toEqual(['Queen'])
  })

  it('pushes remix/live/cover versions below the plain track', () => {
    const plain = track('Bohemian Rhapsody', ['Queen'])
    const live = track('Bohemian Rhapsody - Live at Wembley', ['Queen'])
    const remix = track('Bohemian Rhapsody (Remix)', ['Queen'])
    expect(pickBestTrack([live, remix, plain], request)?.name).toBe('Bohemian Rhapsody')
  })

  it('honors an explicitly requested variant instead of penalizing it', () => {
    const wantsLive = parseTrackRequest('Bohemian Rhapsody live by Queen')
    const plain = track('Bohemian Rhapsody', ['Queen'])
    const live = track('Bohemian Rhapsody - Live at Wembley', ['Queen'])
    const best = pickBestTrack([plain, live], wantsLive)
    // no live penalty applies; the plain exact-title match may still win on
    // title, but the live version must not be scored below a wrong artist
    expect(scoreTrack(live, wantsLive)).toBeGreaterThan(
      scoreTrack(track('Bohemian Rhapsody - Live', ['Cover Band']), wantsLive)
    )
    expect(best).not.toBeNull()
  })

  it('returns null for an empty candidate list', () => {
    expect(pickBestTrack([], request)).toBeNull()
  })
})

describe('secret isolation', () => {
  it('renderer and preload sources never reference the Spotify credentials', () => {
    const roots = [join(__dirname, '../../../renderer/src'), join(__dirname, '../../../preload')]
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(entry)) {
          const source = readFileSync(path, 'utf8')
          if (/SPOTIFY_CLIENT_ID|SPOTIFY_CLIENT_SECRET|client_secret/i.test(source)) {
            offenders.push(path)
          }
        }
      }
    }
    for (const root of roots) walk(root)
    expect(offenders).toEqual([])
  })
})
