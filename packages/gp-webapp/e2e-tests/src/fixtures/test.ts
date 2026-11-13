import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base } from '@playwright/test'

export * from '@playwright/test'

type CachedAsset = { contentType: string; body: Buffer }

type AssetCacheStore = {
  memory: Map<string, CachedAsset>
  stats: {
    cacheRequests: number
    cacheBytes: number
    networkRequests: number
    networkBytes: number
  }
}

const assetCacheEnabled = process.env.E2E_ASSET_CACHE === 'on'
const assetCacheDir =
  process.env.E2E_ASSET_CACHE_DIR || join(tmpdir(), 'gp-e2e-asset-cache')
const assetCacheStatsDir =
  process.env.E2E_ASSET_CACHE_STATS_DIR ||
  join(__dirname, '../../test-results/asset-cache-stats')

// Every test gets a fresh browser context, so without this each one downloads
// the whole Next.js bundle from Vercel again. Files under /_next/static are
// named by content hash, so the pathname alone identifies the bytes across
// deployments (the host and ?dpl= differ per preview). next dev keeps stable
// paths across code changes, so a local server is never cached.
export const test = base.extend<
  { assetCache: void },
  { assetCacheStore: AssetCacheStore }
>({
  assetCacheStore: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright forces us to use destructuring here.
    async ({}, use, workerInfo) => {
      const store: AssetCacheStore = {
        memory: new Map(),
        stats: {
          cacheRequests: 0,
          cacheBytes: 0,
          networkRequests: 0,
          networkBytes: 0,
        },
      }
      await use(store)
      if (!assetCacheEnabled) return
      await mkdir(assetCacheStatsDir, { recursive: true })
      await writeFile(
        join(assetCacheStatsDir, `worker-${workerInfo.workerIndex}.json`),
        JSON.stringify({ workerIndex: workerInfo.workerIndex, ...store.stats }),
      )
    },
    { scope: 'worker' },
  ],
  assetCache: [
    async ({ context, baseURL, assetCacheStore }, use) => {
      if (!assetCacheEnabled || !baseURL) {
        await use()
        return
      }
      const { host: appHost, hostname } = new URL(baseURL)
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        await use()
        return
      }
      const { memory, stats } = assetCacheStore
      await mkdir(assetCacheDir, { recursive: true })
      await context.route(
        (url) =>
          url.host === appHost && url.pathname.startsWith('/_next/static/'),
        async (route) => {
          if (route.request().method() !== 'GET') {
            await route.fallback()
            return
          }
          const key = new URL(route.request().url()).pathname
          const file = join(
            assetCacheDir,
            createHash('sha256').update(key).digest('hex'),
          )
          let cached = memory.get(key)
          if (!cached) {
            const stored = await readFile(file).catch(() => undefined)
            if (stored) {
              const newline = stored.indexOf(10)
              cached = {
                contentType: stored.subarray(0, newline).toString(),
                body: stored.subarray(newline + 1),
              }
              memory.set(key, cached)
              // CI prunes entries no test touched this run before saving.
              const now = new Date()
              await utimes(file, now, now)
            }
          }
          if (cached) {
            stats.cacheRequests += 1
            stats.cacheBytes += cached.body.length
            await route.fulfill({
              status: 200,
              contentType: cached.contentType,
              body: cached.body,
            })
            return
          }
          const response = await route.fetch()
          const body = await response.body()
          stats.networkRequests += 1
          stats.networkBytes += body.length
          if (response.status() === 200) {
            const contentType =
              response.headers()['content-type'] ?? 'application/octet-stream'
            memory.set(key, { contentType, body })
            const temp = `${file}.${randomUUID()}.tmp`
            await writeFile(
              temp,
              Buffer.concat([Buffer.from(`${contentType}\n`), body]),
            )
            await rename(temp, file)
          }
          await route.fulfill({ response })
        },
      )
      await use()
      await context.unrouteAll({ behavior: 'ignoreErrors' })
    },
    { auto: true },
  ],
})
