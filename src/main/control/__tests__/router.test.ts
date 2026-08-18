import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerScreenCapturer, routeReply } from '../router'
import { registerExternalOpener } from '../websites'

const appsFile = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-router-'))
  const file = join(dir, 'apps.json')
  writeFileSync(
    file,
    JSON.stringify({
      apps: [
        {
          id: 'testapp',
          name: 'TestApp',
          aliases: ['testapp', 'test app'],
          candidates: [process.execPath],
          args: ['-e', 'setTimeout(() => {}, 30)']
        },
        { id: 'ghost', name: 'GhostApp', aliases: ['ghost'], candidates: ['/missing/ghost.exe'] }
      ]
    })
  )
  return file
})()

function mockVisionFetch(
  status: number,
  text = 'You are looking at a code editor, sir.'
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve('{"error":"x"}'),
    json: () => Promise.resolve({ choices: [{ message: { content: text } }] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const screens = [{ label: 'Display 1 of 1, primary', dataUrl: 'data:image/jpeg;base64,aGVsbG8=' }]

beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'test-key')
  vi.stubEnv('JARVIS_APPS_PATH', appsFile)
  registerScreenCapturer(async () => screens)
  registerExternalOpener(() => Promise.resolve())
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('routeReply', () => {
  it('passes plain conversation through untouched', async () => {
    const reply = 'Certainly, sir. Canberra is the capital.'
    expect(await routeReply(reply, 'capital of australia?')).toBe(reply)
  })

  it('executes a successful open_app and uses the model confirmation', async () => {
    const result = await routeReply(
      '{"action":"open_app","target":"testapp","say":"Opening TestApp, sir."}',
      'open testapp'
    )
    expect(result).toBe('Opening TestApp, sir.')
  })

  it('reports a missing executable honestly instead of claiming success', async () => {
    const result = await routeReply(
      '{"action":"open_app","target":"ghost","say":"Opening GhostApp, sir."}',
      'open ghost'
    )
    expect(result).toContain("I wasn't able to open GhostApp")
    expect(result).toContain('path was not found')
    expect(result).not.toBe('Opening GhostApp, sir.')
  })

  it('reports unknown apps as not in the registry', async () => {
    const result = await routeReply('{"action":"open_app","target":"photoshop"}', 'open photoshop')
    expect(result).toContain('application registry')
  })

  it('opens allowlisted websites and refuses unknown ones', async () => {
    const ok = await routeReply('{"action":"open_website","target":"youtube"}', 'open youtube')
    expect(ok).toBe('Opening YouTube, sir.')

    const bad = await routeReply(
      '{"action":"open_website","target":"https://evil.example.com"}',
      'open evil'
    )
    expect(bad).toContain('approved website list')
  })

  it('answers unsupported actions with a clean failure, never silence', async () => {
    const result = await routeReply('{"action":"format_disk"}', 'format my disk')
    expect(result).toContain("isn't supported")
  })

  it('runs the full screen-analysis path: capture → vision → text', async () => {
    const fetchMock = mockVisionFetch(200)
    const result = await routeReply('{"action":"analyze_screen"}', 'what am I looking at?')
    expect(result).toBe('You are looking at a code editor, sir.')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    const content = body.messages[1].content
    expect(content[0].text).toContain('what am I looking at?')
    expect(content[1].image_url.url).toBe('data:image/jpeg;base64,aGVsbG8=')
  })

  it('reports capture failure honestly and does not crash', async () => {
    registerScreenCapturer(async () => {
      throw new Error('capture blew up')
    })
    const result = await routeReply('{"action":"analyze_screen"}', 'look at my screen')
    expect(result).toContain("wasn't able to capture the screen")
  })

  it('reports vision service failure honestly and does not crash', async () => {
    mockVisionFetch(500)
    const result = await routeReply('{"action":"analyze_screen"}', 'look at my screen')
    expect(result).toContain("couldn't complete the screen analysis")
    expect(result).toContain('status 500')
  })
})
