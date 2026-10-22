import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { syncCollection } from './sync-substore.mjs'

// Run against an isolated copy of the real backend, never production data.
const bundle = resolve(
  process.env.SUB_STORE_BACKEND_BUNDLE || '/opt/sub-store/backend/sub-store.bundle.js',
)
assert.ok(existsSync(bundle), 'Set SUB_STORE_BACKEND_BUNDLE to the Sub-Store backend bundle')
const dataDir = await mkdtemp(join(tmpdir(), 'clash-substore-test-'))
const socket = createServer().listen(0, '127.0.0.1')
await once(socket, 'listening')
const port = socket.address().port
await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())))
const baseUrl = `http://127.0.0.1:${port}`
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('SUB_STORE_')),
)
Object.assign(env, {
  SUB_STORE_DATA_BASE_PATH: dataDir,
  SUB_STORE_BACKEND_API_HOST: '127.0.0.1',
  SUB_STORE_BACKEND_API_PORT: String(port),
})
let backend
let daemon

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const timer = globalThis.setTimeout(() => child.kill('SIGKILL'), 3000)
  try {
    await exited
  } finally {
    clearTimeout(timer)
  }
}

async function waitFor(check, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (await check()) return
    } catch {
      // Allow the independent backend and reconciler to start/recover.
    }
    await setTimeout(100)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function request(path, method = 'GET', payload) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(2000),
  })
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`)
  const result = await response.json()
  assert.equal(result.status, 'success')
  return result.data
}

async function startBackend() {
  backend = spawn(process.execPath, [bundle], {
    env,
    cwd: dataDir,
    stdio: 'ignore',
  })
  await waitFor(() => request('/api/subs'), 'isolated Sub-Store backend')
}

function subscription(name, nodeName, port) {
  const credentials = Buffer.from('aes-128-gcm:integration-test').toString('base64')
  return {
    name,
    source: 'local',
    content: `ss://${credentials}@127.0.0.1:${port}#${nodeName}`,
  }
}

async function download(expectedNodes, absentNodes = []) {
  const response = await fetch(`${baseUrl}/download/collection/all?target=ClashMeta`)
  const content = await response.text()
  assert.equal(response.status, 200, `Mihomo collection download succeeds: ${content}`)
  assert.match(content, /proxies/)
  for (const name of expectedNodes) assert.ok(content.includes(name), `${name} is exported`)
  for (const name of absentNodes) assert.ok(!content.includes(name), `${name} is removed`)
}

try {
  await startBackend()
  assert.deepEqual(await syncCollection(baseUrl), { changed: true, count: 0 })
  assert.deepEqual(await syncCollection(baseUrl), { changed: false, count: 0 })
  console.log('✓ creates all on an empty installation and avoids unnecessary writes')

  await request('/api/subs', 'POST', subscription('alpha', 'Node-A', 10001))
  await request('/api/subs', 'POST', subscription('beta', 'Node-B', 10002))
  const processRules = [{ type: 'Sort Operator', args: 'asc' }]
  await request('/api/collection/all', 'PATCH', {
    displayName: 'Custom label',
    remark: 'Keep collection settings',
    process: processRules,
    subscriptions: ['beta', 'deleted-sub', 'beta'],
  })
  const custom = {
    name: 'custom',
    displayName: 'Separate collection',
    subscriptions: ['alpha'],
  }
  await request('/api/collections', 'POST', custom)
  assert.deepEqual(await syncCollection(baseUrl), { changed: true, count: 2 })
  const collection = await request('/api/collection/all')
  assert.deepEqual(collection.subscriptions, ['beta', 'alpha'])
  assert.equal(collection.displayName, 'Custom label')
  assert.equal(collection.remark, 'Keep collection settings')
  assert.deepEqual(collection.process, processRules)
  assert.deepEqual(await request('/api/collection/custom'), custom)
  await download(['Node-A', 'Node-B'])
  console.log(
    '✓ repairs an empty/stale membership, preserves ordering, processors and other collections',
  )

  await request('/api/sub/alpha', 'PATCH', { name: 'renamed-alpha' })
  await request('/api/sub/beta', 'DELETE')
  await request('/api/subs', 'POST', subscription('gamma', 'Node-C', 10003))
  await syncCollection(baseUrl)
  assert.deepEqual((await request('/api/collection/all')).subscriptions, ['renamed-alpha', 'gamma'])
  await download(['Node-A', 'Node-C'], ['Node-B'])
  console.log('✓ renamed, deleted and newly added subscriptions are reflected in the real export')

  await request('/api/collection/all', 'DELETE')
  await syncCollection(baseUrl)
  assert.deepEqual((await request('/api/collection/all')).subscriptions, ['renamed-alpha', 'gamma'])
  await download(['Node-A', 'Node-C'])
  console.log('✓ recreates a deleted managed collection without changing subscriptions')

  await request('/api/collection/all', 'PATCH', { subscriptions: [] })
  const script = join(dirname(fileURLToPath(import.meta.url)), 'sync-substore.mjs')
  daemon = spawn(process.execPath, [script], {
    env,
    cwd: dataDir,
    stdio: 'ignore',
  })
  await waitFor(
    async () => (await request('/api/collection/all')).subscriptions.length === 2,
    'background repair',
  )
  await stop(backend)
  await setTimeout(2200)
  await startBackend()
  await request('/api/subs', 'POST', subscription('delta', 'Node-D', 10004))
  await waitFor(
    async () => (await request('/api/collection/all')).subscriptions.includes('delta'),
    'recovery after backend restart',
  )
  await download(['Node-A', 'Node-C', 'Node-D'])
  console.log('✓ running reconciler repairs memberships and recovers after backend restart')
} finally {
  await stop(daemon)
  await stop(backend)
  await rm(dataDir, { recursive: true, force: true })
}
