/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { ExpirationPlugin, NetworkFirst, Serwist } from 'serwist'

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
    // defaultCache's /api rule without its 10s networkTimeoutSeconds: a slow
    // read got the URL's last cached response, which is keyed by URL while the
    // org travels in a header. The cache now answers only when offline.
    {
      matcher: ({ sameOrigin, url: { pathname } }) =>
        sameOrigin &&
        pathname.startsWith('/api/') &&
        !pathname.startsWith('/api/auth/'),
      method: 'GET',
      handler: new NetworkFirst({
        cacheName: 'apis',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 16,
            maxAgeSeconds: 24 * 60 * 60,
            maxAgeFrom: 'last-used',
          }),
        ],
      }),
    },
    ...defaultCache,
  ],
})

serwist.addEventListeners()
