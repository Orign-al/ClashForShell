// Integration smoke test: requires a running ClashForShell Sub-Store service.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { connectBrowser, waitFor } from './lib/cdp.mjs'
import { launchChrome } from './lib/chrome.mjs'
import { DIST_DIR } from './lib/harness.mjs'
import { findFreePort } from './lib/ports.mjs'
import { serveDirectory } from './lib/static-server.mjs'
import { createMockServer } from './mock-server.mjs'

const frontend = new URL(process.env.SUB_STORE_URL || 'http://127.0.0.1:23002/')
const backendPath = process.env.SUB_STORE_FRONTEND_BACKEND_PATH || '/mihomo-sub-store-api'
const backendFor = (url) => new URL(backendPath, url.origin).href.replace(/\/$/, '')
const port = await findFreePort()
const chrome = await launchChrome({
  port,
  args: process.getuid?.() === 0 ? ['--no-sandbox'] : [],
})
const browser = await connectBrowser(port)
let assets
let mock

const connected = (page, expected) =>
  waitFor(
    () =>
      page.evaluate(`(() => {
        const saved = JSON.parse(localStorage.getItem('hostAPI') || '{}')
        const active = saved.apis?.find(api => api.name === saved.current)
        return localStorage.getItem('backendConfigured') === 'true'
          && active?.url === ${JSON.stringify(expected)}
      })()`),
    { timeout: 15000 },
  )

const checkFrontend = async (name, url, { stale = false, backend = backendFor(url) } = {}) => {
  const page = await browser.newPage()
  try {
    await page.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.clear(); localStorage.setItem('locale', 'zh');
        ${stale ? `localStorage.setItem('hostAPI', ${JSON.stringify(JSON.stringify({ current: 'old', apis: [{ name: 'old', url: 'http://127.0.0.1:9' }] }))});` : ''}`,
    })
    await page.goto(url.href)
    assert.notEqual(await connected(page, backend), null, `${name}: backend was not selected`)
    const responses = await page.evaluate(`Promise.all(
      ['/api/utils/env', '/api/subs', '/api/collections'].map(async path => {
        const response = await fetch(${JSON.stringify(backend)} + path)
        const body = await response.json()
        return { status: response.status, result: body.status }
      })
    )`)
    assert.deepEqual(responses, Array(3).fill({ status: 200, result: 'success' }))
    assert.notEqual(
      await waitFor(() =>
        page.evaluate(`!document.body.innerText.includes('请输入后端路径或地址')
        && !document.body.innerText.includes('code: 0 msg: Network Error')
        && document.body.innerText.includes('订阅')`),
      ),
      null,
      `${name}: connection prompt or error remained visible`,
    )
    await page.reload()
    assert.notEqual(await connected(page, backend), null, `${name}: reload lost the connection`)
    console.log(`✓ ${name}`)
  } finally {
    await page.close()
  }
}

const checkPwaUpgrade = async () => {
  let upgraded = false
  // Recreate a cached installation from before the bootstrap was added. Only
  // this temporary test origin is changed; the real subscription data is read.
  const proxy = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, frontend)
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
      let body = Buffer.from(await response.arrayBuffer())
      if (!upgraded && ['/', '/subs', '/index.html'].includes(url.pathname)) {
        body = Buffer.from(
          body.toString().replace('<script src="/clashforshell-substore.js"></script>', ''),
        )
      }
      if (!upgraded && url.pathname === '/sw.js') {
        body = Buffer.from(
          body
            .toString()
            .replace(/\{url:"clashforshell-substore\.js",revision:"[^"]*"\},?/g, '')
            .replace(/(url:"index\.html",revision:")[^"]*(")/, '$1legacy-before-bootstrap$2'),
        )
      }
      res.writeHead(response.status, {
        'content-type': response.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'no-store',
      })
      res.end(body)
    } catch {
      res.writeHead(502)
      res.end()
    }
  })
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  const origin = new URL(`http://127.0.0.1:${proxy.address().port}/`)
  const expected = backendFor(origin)
  const page = await browser.newPage()
  try {
    await page.call('Network.setBypassServiceWorker', { bypass: false })
    const initial = new URL(origin)
    initial.searchParams.set('api', expected)
    await page.goto(initial.href)
    assert.notEqual(await connected(page, expected), null)
    assert.notEqual(
      await waitFor(() => page.evaluate('Boolean(navigator.serviceWorker.controller)')),
      null,
      'legacy PWA did not take control',
    )
    await page.evaluate('localStorage.clear()')
    await page.goto(new URL('/subs', origin).href)
    assert.notEqual(await waitFor(() => page.evaluate('document.readyState === "complete"')), null)
    assert.equal(
      await page.evaluate(
        'Boolean(document.querySelector("script[src=\\"/clashforshell-substore.js\\"]"))',
      ),
      false,
    )

    upgraded = true
    await page.evaluate(`(async () => {
      window.pwaUpdated = false
      navigator.serviceWorker.addEventListener('controllerchange', () => { window.pwaUpdated = true }, { once: true })
      const registration = await navigator.serviceWorker.getRegistration()
      await registration.update()
    })()`)
    assert.notEqual(
      await waitFor(() => page.evaluate('window.pwaUpdated')),
      null,
      'PWA update did not activate',
    )
    await page.reload()
    assert.notEqual(
      await connected(page, expected),
      null,
      'cached PWA did not load the repaired page',
    )
    assert.equal(
      await page.evaluate(
        'Boolean(document.querySelector("script[src=\\"/clashforshell-substore.js\\"]"))',
      ),
      true,
    )
    console.log('✓ existing PWA cache upgrades to automatic backend connection')
  } finally {
    await page.close()
    proxy.closeAllConnections()
    await new Promise((resolve) => proxy.close(resolve))
  }
}

try {
  assets = await serveDirectory(DIST_DIR)
  mock = await createMockServer({ groups: 1, nodes: 1, connections: 0 })
  const panel = await browser.newPage()
  try {
    await panel.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.clear();
        localStorage.setItem('setup/api-list', ${JSON.stringify(JSON.stringify([{ uuid: 'test', type: 'clash', protocol: 'http', host: '127.0.0.1', port: String(mock.port), password: '', secondaryPath: '', label: 'test' }]))});
        localStorage.setItem('setup/active-uuid', 'test');`,
    })
    await panel.goto(`${assets.url}/#/proxies`)
    assert.notEqual(
      await waitFor(() =>
        panel.evaluate(`Boolean(document.querySelector('a.subscription-manager'))`),
      ),
      null,
    )
    const link = new URL(
      await panel.evaluate(`document.querySelector('a.subscription-manager').href`),
    )
    assert.equal(link.port, '23002')
    assert.equal(link.hostname, new URL(assets.url).hostname)
    assert.equal(link.searchParams.get('api'), backendFor(link))
    console.log('✓ dashboard link includes its subscription backend')
    if (link.origin === frontend.origin) await checkFrontend('dashboard subscription link', link)
  } finally {
    await panel.close()
  }

  await checkFrontend('direct visit with empty browser storage', frontend)
  await checkFrontend('direct visit with a stale saved backend', frontend, { stale: true })

  const explicit = new URL(frontend)
  const override = new URL(backendFor(frontend))
  if (override.hostname === '127.0.0.1') override.hostname = 'localhost'
  explicit.searchParams.set('api', override.href + '/')
  await checkFrontend('explicit api parameter', explicit, { backend: override.href })

  const magic = new URL(frontend)
  magic.searchParams.set('magicpath', backendPath)
  await checkFrontend('explicit magicpath parameter', magic)

  if (process.env.SUB_STORE_ALT_URL) {
    await checkFrontend(
      'connection through another host address',
      new URL(process.env.SUB_STORE_ALT_URL),
    )
  }
  await checkPwaUpgrade()
} finally {
  browser.close()
  await chrome.close()
  await assets?.close()
  await mock?.close()
}
