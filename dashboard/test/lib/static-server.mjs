// 伺服 dist 的静态服务器。zashboard 走 hash 路由,所以任何未知路径都回 index.html 即可。
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const MIME = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export const serveDirectory = (root, port = 0) => {
  const server = createServer((req, res) => {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    // 挡住 ../ 逃逸:normalize 之后必须还在 root 里
    const candidate = normalize(join(root, requested))
    const file =
      candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : join(root, 'index.html')

    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port

      resolve({
        url: `http://127.0.0.1:${actualPort}`,
        port: actualPort,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.()
            server.close(done)
          }),
      })
    })
  })
}
