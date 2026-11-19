import type { Browser } from 'playwright-core'
import { describe, expect, it, vi } from 'vitest'
import { hopAllowed, navigateInBrowser } from './agentBrowser.service'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}))

type Paused = { requestId: string; request: { url: string } }

// A browser whose navigation to `url` requests each of `hops` in turn, the
// way Chromium pauses each document request (redirects included) once
// Fetch.enable is on. A hop the guard fails ends the navigation, as
// Fetch.failRequest does.
const browserNavigating = (hops: string[]) => {
  const sent: { method: string; params: unknown }[] = []
  let onPaused: ((event: Paused) => void) | undefined
  const cdp = {
    on: (event: string, handler: (event: Paused) => void) => {
      if (event === 'Fetch.requestPaused') onPaused = handler
    },
    send: async (method: string, params: unknown) => {
      sent.push({ method, params })
      return {}
    },
  }
  let current = ''
  const page = {
    goto: async () => {
      for (const [i, hop] of hops.entries()) {
        if (!sent.some((s) => s.method === 'Fetch.enable')) break
        onPaused?.({ requestId: `r${i}`, request: { url: hop } })
        await vi.waitFor(() =>
          expect(
            sent.some(
              (s) =>
                (s.method === 'Fetch.continueRequest' ||
                  s.method === 'Fetch.failRequest') &&
                JSON.stringify(s.params).includes(`"r${i}"`),
            ),
          ).toBe(true),
        )
        if (sent.at(-1)?.method === 'Fetch.failRequest') {
          throw new Error('net::ERR_BLOCKED_BY_CLIENT')
        }
        current = hop
      }
      return { status: () => 200 }
    },
    waitForLoadState: async () => undefined,
    url: () => current,
    content: async () => '<p>Page</p>',
  }
  const context = {
    newPage: async () => page,
    newCDPSession: async () => cdp,
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const browser = { newContext: async () => context } as unknown as Browser
  return { browser, sent }
}

describe('navigateInBrowser', () => {
  it('intercepts every document request and lets public ones through', async () => {
    const { browser, sent } = browserNavigating([
      'https://news.example.com/a',
      'https://www.news.example.com/a',
    ])
    expect(
      await navigateInBrowser(
        browser,
        'https://news.example.com/a',
        hopAllowed,
      ),
    ).toEqual({
      blocked: false,
      status: 200,
      finalUrl: 'https://www.news.example.com/a',
      html: '<p>Page</p>',
    })
    expect(sent[0]).toEqual({
      method: 'Fetch.enable',
      params: {
        patterns: [
          {
            urlPattern: '*',
            resourceType: 'Document',
            requestStage: 'Request',
          },
        ],
      },
    })
    expect(sent.slice(1)).toEqual([
      { method: 'Fetch.continueRequest', params: { requestId: 'r0' } },
      { method: 'Fetch.continueRequest', params: { requestId: 'r1' } },
    ])
  })

  it('fails a redirect hop to a private address and reports the page blocked', async () => {
    const { browser, sent } = browserNavigating([
      'https://news.example.com/a',
      'http://169.254.169.254/latest/meta-data',
    ])
    expect(
      await navigateInBrowser(
        browser,
        'https://news.example.com/a',
        hopAllowed,
      ),
    ).toEqual({ blocked: true })
    expect(sent.slice(1)).toEqual([
      { method: 'Fetch.continueRequest', params: { requestId: 'r0' } },
      {
        method: 'Fetch.failRequest',
        params: { requestId: 'r1', errorReason: 'BlockedByClient' },
      },
    ])
  })
})
