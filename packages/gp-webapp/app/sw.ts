/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { NetworkOnly, Serwist } from 'serwist'

// Precache manifest is injected by `serwist build` at build time.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // API responses are never cached: the cache was keyed by URL while the
    // org travels in a header, so it could answer with another org's data.
    {
      matcher: ({ sameOrigin, url: { pathname } }) =>
        sameOrigin && pathname.startsWith('/api/'),
      method: 'GET',
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
})

// Devices that ran the earlier worker still hold its API cache.
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('apis'))
})

serwist.addEventListeners()
