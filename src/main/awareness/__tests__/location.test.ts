import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatLocationContext, getLocationInfo, resolveLocation } from '../location'

afterEach(() => vi.unstubAllEnvs())

describe('resolveLocation', () => {
  it.each([
    ['Sistranda', 'sistranda'],
    ['sistranda', 'sistranda'],
    ['Frøya', 'sistranda'],
    ['froya', 'sistranda'],
    ['Trondheim', 'trondheim'],
    ['trondheim sentrum', 'trondheim']
  ])('maps %s to weather location %s', (input, expected) => {
    const info = resolveLocation(input)
    expect(info.configured).toBe(true)
    expect(info.weatherLocationId).toBe(expected)
  })

  it('keeps an unsupported location without weather coverage', () => {
    const info = resolveLocation('Oslo')
    expect(info).toEqual({ configured: true, name: 'Oslo' })
  })

  it.each([undefined, '', '   '])('reports not configured for %j', (input) => {
    expect(resolveLocation(input as string | undefined)).toEqual({ configured: false })
  })
})

describe('formatLocationContext', () => {
  it('links a supported location to the weather feed and defines "here"', () => {
    vi.stubEnv('JARVIS_LOCATION', 'Sistranda')
    const line = formatLocationContext(getLocationInfo())
    expect(line).toContain('Sistranda')
    expect(line).toContain('Sistranda / Frøya')
    expect(line).toContain('"here" refers to this location')
  })

  it('forbids invented weather for unsupported locations', () => {
    vi.stubEnv('JARVIS_LOCATION', 'Oslo')
    const line = formatLocationContext(getLocationInfo())
    expect(line).toContain('Oslo')
    expect(line).toContain('never invent current conditions')
  })

  it('instructs honesty when no location is configured', () => {
    const line = formatLocationContext(resolveLocation(undefined))
    expect(line).toContain('not configured')
    expect(line).toContain('never guess')
  })
})
