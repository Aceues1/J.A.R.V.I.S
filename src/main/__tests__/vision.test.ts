import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GroqConfigError, GroqRequestError } from '../groq'
import { MAX_SCREENS, analyzeScreens, getVisionModel } from '../vision'

const screens = [
  { label: 'Display 1 of 2, primary, 2560x1440', dataUrl: 'data:image/jpeg;base64,AAAA' },
  { label: 'Display 2 of 2, 1920x1080', dataUrl: 'data:image/jpeg;base64,BBBB' }
]

function mockFetch(
  status: number,
  content: unknown = 'A calm description, sir.'
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve('{"error":"details"}'),
    json: () => Promise.resolve({ choices: [{ message: { content } }] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => vi.stubEnv('GROQ_API_KEY', 'test-key'))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('getVisionModel', () => {
  it('defaults to the current supported Groq vision model', () => {
    expect(getVisionModel()).toBe('qwen/qwen3.6-27b')
  })

  it('honors GROQ_VISION_MODEL override', () => {
    vi.stubEnv('GROQ_VISION_MODEL', 'custom-vision')
    expect(getVisionModel()).toBe('custom-vision')
  })
})

describe('analyzeScreens', () => {
  it('sends the question plus every labelled monitor image in vision format', async () => {
    const fetchMock = mockFetch(200)
    await analyzeScreens('What am I looking at?', screens)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/chat/completions')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('qwen/qwen3.6-27b')

    const content = body.messages[1].content
    expect(content[0].type).toBe('text')
    expect(content[0].text).toContain('What am I looking at?')
    expect(content[0].text).toContain('Display 1 of 2, primary')
    expect(content[0].text).toContain('Display 2 of 2')
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: screens[0].dataUrl } })
    expect(content[2]).toEqual({ type: 'image_url', image_url: { url: screens[1].dataUrl } })
  })

  it('keeps the persona and both analysis modes in the system prompt', async () => {
    const fetchMock = mockFetch(200)
    await analyzeScreens('x', screens)
    const system = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content
    expect(system).toContain('You are JARVIS')
    expect(system).toContain('# Screen analysis')
    expect(system).toContain('never a robotic inventory')
    expect(system).toContain('answer the question directly')
  })

  it('caps the number of images at the Groq limit', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      label: `Display ${i + 1}`,
      dataUrl: `data:image/jpeg;base64,IMG${i}`
    }))
    const fetchMock = mockFetch(200)
    await analyzeScreens('x', many)
    const content = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content
    expect(content.filter((c: { type: string }) => c.type === 'image_url')).toHaveLength(
      MAX_SCREENS
    )
  })

  it('rejects an empty capture set', async () => {
    await expect(analyzeScreens('x', [])).rejects.toThrow(/no images/i)
  })

  it.each([401, 403])('maps %i to a config error', async (status) => {
    mockFetch(status)
    await expect(analyzeScreens('x', screens)).rejects.toBeInstanceOf(GroqConfigError)
  })

  it('maps 429 to a rate-limit error and 500 to a status error', async () => {
    mockFetch(429)
    await expect(analyzeScreens('x', screens)).rejects.toThrow(/rate limit/i)
    mockFetch(500)
    await expect(analyzeScreens('x', screens)).rejects.toThrow(/status 500/)
  })

  it('maps timeouts and network failures to readable errors', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'TimeoutError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
    await expect(analyzeScreens('x', screens)).rejects.toThrow(/timed out/i)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(analyzeScreens('x', screens)).rejects.toThrow(/could not reach/i)
  })

  it('rejects an empty completion', async () => {
    mockFetch(200, '')
    await expect(analyzeScreens('x', screens)).rejects.toBeInstanceOf(GroqRequestError)
  })

  it('never includes the API key in error messages', async () => {
    mockFetch(500)
    await expect(analyzeScreens('x', screens)).rejects.toSatisfy(
      (err: Error) => !err.message.includes('test-key')
    )
  })
})
