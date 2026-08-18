import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serveRendererDirectory, type RendererServer } from '../renderer-server'

// The production loopback server exists so the renderer runs on a real
// http://127.0.0.1 origin (YouTube embeds reject file:// with Error 153).
// These tests pin its contract: loopback-only, root-jailed, correct types.

let dir: string
let server: RendererServer

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-renderer-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>JARVIS</title>')
  writeFileSync(join(dir, 'app.js'), 'console.log("hi")')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'style.css'), 'body{}')
  // A secret OUTSIDE the served root that traversal must never reach.
  writeFileSync(join(dir, '..', 'jarvis-secret.txt'), 'top secret')
  server = await serveRendererDirectory(dir)
})

afterAll(() => {
  server.close()
})

describe('serveRendererDirectory', () => {
  it('binds to the loopback interface on an ephemeral port', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
  })

  it('serves index.html at / with an html content type', async () => {
    const res = await fetch(server.url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('JARVIS')
  })

  it('serves nested assets with their content types', async () => {
    const js = await fetch(`${server.url}app.js`)
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('text/javascript')

    const css = await fetch(`${server.url}assets/style.css`)
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toContain('text/css')
  })

  it('returns 404 for missing files', async () => {
    const res = await fetch(`${server.url}nope.js`)
    expect(res.status).toBe(404)
  })

  it('refuses path traversal outside the renderer root', async () => {
    // fetch normalizes "../" in URLs, so drive the raw socket path instead.
    const port = Number(new URL(server.url).port)
    const raw = await new Promise<string>((resolvePromise, rejectPromise) => {
      import('net').then(({ connect }) => {
        const sock = connect(port, '127.0.0.1', () => {
          sock.write('GET /../jarvis-secret.txt HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n')
        })
        let buf = ''
        sock.on('data', (d) => {
          buf += String(d)
          sock.end()
        })
        sock.on('close', () => resolvePromise(buf))
        sock.on('error', rejectPromise)
      })
    })
    expect(raw).toMatch(/^HTTP\/1\.1 (403|404)/)
    expect(raw).not.toContain('top secret')

    // Encoded traversal goes through fetch untouched — must be jailed too.
    const encoded = await fetch(`${server.url}..%2Fjarvis-secret.txt`)
    expect([403, 404]).toContain(encoded.status)
    expect(await encoded.text()).not.toContain('top secret')
  })
})
