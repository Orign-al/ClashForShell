import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Sub-Store uses the api query parameter to select and save its backend.
// Initialize it before the upstream application loads, including direct visits
// to the subscription UI. Derive the origin in the browser for portable installs.
const frontendDir = process.env.SUB_STORE_FRONTEND_PATH || '/opt/sub-store/frontend'
const backendPath = process.env.SUB_STORE_FRONTEND_BACKEND_PATH || '/mihomo-sub-store-api'

if (!backendPath.startsWith('/') || backendPath.startsWith('//')) {
  throw new Error('SUB_STORE_FRONTEND_BACKEND_PATH must be a path on the frontend origin')
}

const bootstrap = `(() => {
  const url = new URL(window.location.href)
  if (url.searchParams.has('api') || url.searchParams.has('magicpath')) return
  url.searchParams.set('api', new URL(${JSON.stringify(backendPath)}, url.origin).href.replace(/\\/$/, ''))
  window.history.replaceState(window.history.state, '', url.href)
})()
`

const indexPath = join(frontendDir, 'index.html')
const tag = '<script src="/clashforshell-substore.js"></script>'
let html = readFileSync(indexPath, 'utf8')

writeFileSync(join(frontendDir, 'clashforshell-substore.js'), bootstrap)
if (!html.includes(tag)) {
  if (!/<head\b[^>]*>/i.test(html)) throw new Error('Sub-Store index.html has no head element')
  html = html.replace(/<head\b[^>]*>/i, (head) => head + '\n  ' + tag)
  writeFileSync(indexPath, html)
}

// Invalidate the upstream PWA's cached index as well. Otherwise an existing
// installation can keep serving HTML without the bootstrap after an upgrade.
const swPath = join(frontendDir, 'sw.js')
if (existsSync(swPath)) {
  const revision = (text) => createHash('sha256').update(text).digest('hex')
  const indexEntry = /(url:\s*["']index\.html["'],\s*revision:\s*["'])[^"']*(["'])/
  let sw = readFileSync(swPath, 'utf8')
  if (!indexEntry.test(sw) || !sw.includes('.precacheAndRoute([')) {
    throw new Error('Unrecognized Sub-Store service worker precache manifest')
  }
  sw = sw.replace(indexEntry, (_, prefix, suffix) => prefix + revision(html) + suffix)
  sw = sw.replace(/\{url:"clashforshell-substore\.js",revision:"[^"]*"\},?/g, '')
  sw = sw.replace(
    '.precacheAndRoute([',
    `.precacheAndRoute([{url:"clashforshell-substore.js",revision:"${revision(bootstrap)}"},`,
  )
  writeFileSync(swPath, sw)
}
