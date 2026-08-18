import { createServer, type Server } from 'http'
import { promises as fs } from 'fs'
import { extname, join, normalize, resolve, sep } from 'path'

// Serves the built renderer over a loopback HTTP origin in production.
// YouTube's embed player rejects file:// origins (Error 153), so the window
// must load from http://127.0.0.1 rather than loadFile(). Bound strictly to
// the loopback interface on an ephemeral port; serves only files inside the
// renderer output directory (no traversal, no directory listings). The dev
// workflow (Vite server) is unaffected.

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

export interface RendererServer {
  url: string
  close: () => void
}

export function serveRendererDirectory(rootDir: string): Promise<RendererServer> {
  const root = resolve(rootDir)

  const server: Server = createServer(async (req, res) => {
    try {
      const rawPath = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
      const relative = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '')
      const filePath = normalize(join(root, relative))
      if (filePath !== root && !filePath.startsWith(root + sep)) {
        res.writeHead(403).end()
        return
      }

      const data = await fs.readFile(filePath)
      res.writeHead(200, {
        'Content-Type':
          CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache'
      })
      res.end(data)
    } catch {
      res.writeHead(404).end()
    }
  })

  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        rejectPromise(new Error('renderer server failed to bind'))
        return
      }
      resolvePromise({
        url: `http://127.0.0.1:${address.port}/`,
        close: () => server.close()
      })
    })
  })
}
