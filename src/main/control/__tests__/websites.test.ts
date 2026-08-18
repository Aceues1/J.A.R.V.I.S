import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWebsite, registerExternalOpener, resolveWebsite } from '../websites'

afterEach(() => {
  registerExternalOpener(() => Promise.resolve())
})

describe('resolveWebsite', () => {
  it.each([
    ['youtube', 'https://www.youtube.com'],
    ['YouTube', 'https://www.youtube.com'],
    ['google', 'https://www.google.com'],
    ['the web', 'https://www.google.com'],
    ['browse', 'https://www.google.com'],
    ['instagram', 'https://www.instagram.com'],
    ['open youtube for me', 'https://www.youtube.com']
  ])('resolves %j to %s', (input, url) => {
    expect(resolveWebsite(input)?.url).toBe(url)
  })

  it('supports the new-Google-Doc deep link from the guide', () => {
    expect(resolveWebsite('new google doc')?.url).toBe('https://docs.google.com/document/create')
    expect(resolveWebsite('new sheet')?.url).toBe('https://docs.google.com/spreadsheets/create')
  })

  it('accepts explicit https URLs only for allowlisted hostnames', () => {
    expect(resolveWebsite('https://www.youtube.com/watch?v=abc')?.url).toBe(
      'https://www.youtube.com/watch?v=abc'
    )
    expect(resolveWebsite('https://evil.example.com/phish')).toBeNull()
    expect(resolveWebsite('http://www.youtube.com')).toBeNull()
    expect(resolveWebsite('file:///etc/passwd')).toBeNull()
    expect(resolveWebsite('https://not a url')).toBeNull()
  })

  it('returns null for unknown targets', () => {
    expect(resolveWebsite('myspace')).toBeNull()
    expect(resolveWebsite(undefined)).toBeNull()
    expect(resolveWebsite('')).toBeNull()
  })
})

describe('openWebsite', () => {
  const site = { id: 'youtube', name: 'YouTube', aliases: [], url: 'https://www.youtube.com' }

  it('opens through the registered external opener and reports success', async () => {
    const opener = vi.fn().mockResolvedValue(undefined)
    registerExternalOpener(opener)
    const result = await openWebsite(site)
    expect(opener).toHaveBeenCalledWith('https://www.youtube.com')
    expect(result.ok).toBe(true)
  })

  it('reports an opener failure honestly', async () => {
    registerExternalOpener(vi.fn().mockRejectedValue(new Error('no browser')))
    const result = await openWebsite(site)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('could not be opened')
  })
})
