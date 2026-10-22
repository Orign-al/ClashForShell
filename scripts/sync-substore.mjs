import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

// The provider in config.yaml reads the managed `all` collection. Sub-Store
// removes deleted subscriptions from collections, but doesn't add new ones.
// Reconcile membership through its API without replacing processing rules.
export async function syncCollection(baseUrl) {
  const request = async (path, method = 'GET', payload) => {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`Sub-Store ${path}: HTTP ${response.status}`)
    const result = await response.json()
    if (result.status !== 'success') throw new Error(`Sub-Store ${path}: request failed`)
    return result.data
  }

  const [subs, collections] = await Promise.all([request('/api/subs'), request('/api/collections')])
  if (!Array.isArray(subs) || !Array.isArray(collections)) {
    throw new Error('Sub-Store returned invalid subscription data')
  }
  if (subs.some((sub) => typeof sub?.name !== 'string' || !sub.name)) {
    throw new Error('Sub-Store returned an invalid subscription name')
  }

  const names = new Set(subs.map((sub) => sub.name))
  const collection = collections.find((item) => item.name === 'all')
  const previous = Array.isArray(collection?.subscriptions) ? collection.subscriptions : []
  // Keep the user's ordering; append newly created or renamed subscriptions.
  const subscriptions = [...new Set([...previous.filter((name) => names.has(name)), ...names])]
  if (!collection) {
    await request('/api/collections', 'POST', {
      name: 'all',
      displayName: '全部节点',
      subscriptions,
    })
  } else if (JSON.stringify(previous) !== JSON.stringify(subscriptions)) {
    await request('/api/collection/all', 'PATCH', { subscriptions })
  } else {
    return { changed: false, count: subscriptions.length }
  }
  return { changed: true, count: subscriptions.length }
}

async function main() {
  const baseUrl = `http://127.0.0.1:${process.env.SUB_STORE_BACKEND_API_PORT || 3001}`
  const controller = new AbortController()
  process.once('SIGTERM', () => controller.abort())
  process.once('SIGINT', () => controller.abort())
  let lastError

  while (!controller.signal.aborted) {
    try {
      const { changed, count } = await syncCollection(baseUrl)
      if (changed || lastError) console.log(`[subscriptions] all ready (${count} subscriptions)`)
      lastError = undefined
    } catch (error) {
      if (error.message !== lastError) console.error(`[subscriptions] ${error.message}; retrying`)
      lastError = error.message
    }
    try {
      await setTimeout(2000, undefined, { signal: controller.signal })
    } catch {
      break
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
