import { createServer, type Server } from 'node:http'
import axios from 'axios'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentWebService,
  RequestDeadlineError,
  type WebHop,
} from './agentWeb.service'
import { checkLink } from './checkLink'
import { fetchPage } from './fetchPage'
import type { AgentPageReplayService, AgentRunReplay } from './judgeReplay'
import type { ToolContext } from './tool'

const hop = (status: number, extra: Partial<WebHop> = {}): WebHop => ({
  status,
  contentType: 'text/html; charset=utf-8',
  body: Buffer.from(''),
  ...extra,
})

const replayStub = (
  pages: Partial<
    Pick<AgentPageReplayService, 'lookupFetch' | 'lookupHead'>
  > = {},
) => ({
  lookupFetch: vi.fn(pages.lookupFetch ?? (async () => undefined)),
  lookupHead: vi.fn(pages.lookupHead ?? (async () => undefined)),
})

// A site whose redirects are scripted by URL.
const webWith = (hops: Record<string, WebHop>, replay = replayStub()) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const web = new AgentWebService(replay as unknown as AgentPageReplayService)
  const requested: string[] = []
  vi.spyOn(web, 'request').mockImplementation(async (_method, url) => {
    requested.push(url)
    const answer = hops[url]
    if (!answer) throw new Error(`unscripted request to ${url}`)
    return answer
  })
  const ctx: ToolContext = {
    runId: 'run-1',
    stepKey: '0:fetchPage:0',
    organizationSlug: 'org',
    signal: new AbortController().signal,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    get: (() => web) as unknown as ToolContext['get'],
  }
  return { web, requested, ctx, replay }
}

describe('AgentWebService redirects', () => {
  it('follows a redirect chain and reports the final URL', async () => {
    const { ctx, requested } = webWith({
      'https://a.gov/start': hop(301, { location: '/moved' }),
      'https://a.gov/moved': hop(302, { location: 'https://b.org/final' }),
      'https://b.org/final': hop(200, { body: Buffer.from('<p>Hi</p>') }),
    })
    const page = await fetchPage.execute({ url: 'https://a.gov/start' }, ctx)
    expect(page).toMatchObject({
      ok: true,
      finalUrl: 'https://b.org/final',
      content: 'Hi',
    })
    expect(requested).toEqual([
      'https://a.gov/start',
      'https://a.gov/moved',
      'https://b.org/final',
    ])
  })

  it.each([
    ['a private address', 'http://10.0.0.7/admin'],
    ['the metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['localhost', 'http://localhost:3000/'],
    ['a private IPv6 address', 'http://[fd00::1]/'],
  ])(
    'refuses a redirect to %s in the middle of a chain, before requesting it',
    async (_name, privateUrl) => {
      const { ctx, requested } = webWith({
        'https://a.gov/start': hop(302, { location: 'https://a.gov/next' }),
        'https://a.gov/next': hop(302, { location: privateUrl }),
        [privateUrl]: hop(200, { body: Buffer.from('secret') }),
        'https://a.gov/after': hop(200),
      })
      const page = await fetchPage.execute({ url: 'https://a.gov/start' }, ctx)
      expect(page).toEqual({ ok: false, reason: 'blocked_host' })
      expect(requested).not.toContain(privateUrl)
    },
  )

  it('refuses a redirect to a non-http scheme', async () => {
    const { ctx } = webWith({
      'https://a.gov/start': hop(302, { location: 'file:///etc/passwd' }),
    })
    const page = await fetchPage.execute({ url: 'https://a.gov/start' }, ctx)
    expect(page).toEqual({ ok: false, reason: 'invalid_url' })
  })

  it('gives up after five redirects', async () => {
    const hops: Record<string, WebHop> = {}
    for (let n = 0; n < 7; n++) {
      hops[`https://a.gov/${n}`] = hop(302, { location: `/${n + 1}` })
    }
    const { ctx, requested } = webWith(hops)
    const link = await checkLink.execute({ url: 'https://a.gov/0' }, ctx)
    expect(link).toEqual({ ok: false, reason: 'too_many_redirects' })
    expect(requested).toHaveLength(6)
  })

  it('checks the address a hostname resolves to when each request connects', async () => {
    const server: Server = createServer((_req, res) => res.end('reached'))
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const web = new AgentWebService({} as AgentPageReplayService)
      await expect(
        web.request(
          'GET',
          `http://localhost:${port}/`,
          new AbortController().signal,
        ),
      ).rejects.toThrow('non-public IP')
    } finally {
      server.close()
    }
  })
})

describe('AgentWebService deadline', () => {
  it('ends a request that is still going at its deadline, however busy the socket', async () => {
    // A server that keeps the socket busy never trips axios's idle timeout;
    // this stand-in for axios settles only when its signal aborts.
    const pending = vi.spyOn(axios, 'request').mockImplementation(
      (config) =>
        new Promise((_resolve, reject) => {
          const signal = config.signal
          if (signal instanceof AbortSignal) {
            signal.addEventListener('abort', () =>
              reject(new axios.CanceledError()),
            )
          }
        }),
    )
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const web = new AgentWebService({} as AgentPageReplayService)
      await expect(
        web.request(
          'GET',
          'https://a.gov/drip',
          new AbortController().signal,
          50,
        ),
      ).rejects.toBeInstanceOf(RequestDeadlineError)
    } finally {
      pending.mockRestore()
    }
  })

  it('reports a deadline as a timeout, not a fetch failure', async () => {
    const { ctx, web } = webWith({})
    vi.mocked(web.request).mockRejectedValue(new RequestDeadlineError())
    expect(await fetchPage.execute({ url: 'https://a.gov/drip' }, ctx)).toEqual(
      { ok: false, reason: 'timeout' },
    )
  })
})

describe('fetchPage', () => {
  it('reads a long page in slices', async () => {
    const text = 'word '.repeat(5_000)
    const { ctx } = webWith({
      'https://a.gov/long': hop(200, {
        contentType: 'text/plain',
        body: Buffer.from(text),
      }),
    })
    const first = await fetchPage.execute({ url: 'https://a.gov/long' }, ctx)
    const second = await fetchPage.execute(
      { url: 'https://a.gov/long', offset: 10_000 },
      ctx,
    )
    expect(first).toMatchObject({ truncated: true, offset: 0 })
    expect(second).toMatchObject({ truncated: true, offset: 10_000 })
  })

  it('reports the page own published date, so a citation is dated by its page', async () => {
    const html = `<html><head>
      <meta property="article:published_time" content="2026-11-14T23:30:00-05:00">
      </head><body><p>Story</p></body></html>`
    const { ctx } = webWith({
      'https://a.gov/story': hop(200, { body: Buffer.from(html) }),
      'https://a.gov/plain': hop(200, {
        contentType: 'text/plain',
        body: Buffer.from('No date here'),
      }),
    })
    expect(
      await fetchPage.execute({ url: 'https://a.gov/story' }, ctx),
    ).toMatchObject({ ok: true, published: '2026-11-14' })
    expect(
      await fetchPage.execute({ url: 'https://a.gov/plain' }, ctx),
    ).toMatchObject({ ok: true, published: null })
  })

  it('falls back to a time element, then to JSON-LD, for the published date', async () => {
    const { ctx } = webWith({
      'https://a.gov/time': hop(200, {
        body: Buffer.from(
          '<html><body><time datetime="2026-10-02">Oct 2</time></body></html>',
        ),
      }),
      'https://a.gov/ld': hop(200, {
        body: Buffer.from(
          '<html><head><script type="application/ld+json">' +
            '{"@type":"NewsArticle","datePublished":"2026-09-08T06:00:00Z"}' +
            '</script></head><body>Story</body></html>',
        ),
      }),
    })
    expect(
      await fetchPage.execute({ url: 'https://a.gov/time' }, ctx),
    ).toMatchObject({ published: '2026-10-02' })
    expect(
      await fetchPage.execute({ url: 'https://a.gov/ld' }, ctx),
    ).toMatchObject({ published: '2026-09-08' })
  })

  it('turns away a PDF and an error status', async () => {
    const { ctx } = webWith({
      'https://a.gov/packet.pdf': hop(200, { contentType: 'application/pdf' }),
      'https://a.gov/gone': hop(404),
    })
    expect(
      await fetchPage.execute({ url: 'https://a.gov/packet.pdf' }, ctx),
    ).toMatchObject({ ok: false, reason: 'unsupported_content_type' })
    expect(await fetchPage.execute({ url: 'https://a.gov/gone' }, ctx)).toEqual(
      { ok: false, reason: 'http_error', status: 404 },
    )
  })

  it('serves a judge run the recorded page before going to the web', async () => {
    const judgeReplay: AgentRunReplay = {
      replay: {
        mode: 'replay',
        key: '_judge/replay/sweep/s1/trending_issues/a1-baseline-1',
      },
      judgeRunId: '_judge-abc',
      issuedAt: 1_800_000_000,
    }
    const replay = replayStub({
      lookupFetch: async () => ({
        status: 200,
        contentType: 'text/html',
        finalUrl: 'https://a.gov/news/',
        body: Buffer.from('Recorded visible text'),
      }),
    })
    const { ctx, requested } = webWith({}, replay)
    const page = await fetchPage.execute(
      { url: 'https://a.gov/news' },
      { ...ctx, judgeReplay },
    )
    expect(page).toMatchObject({
      ok: true,
      finalUrl: 'https://a.gov/news/',
      content: 'Recorded visible text',
    })
    expect(replay.lookupFetch).toHaveBeenCalledWith(
      judgeReplay,
      'https://a.gov/news',
    )
    expect(requested).toEqual([])
  })
})

describe('checkLink', () => {
  it('returns the status of a HEAD request without reading the page', async () => {
    const { ctx, web } = webWith({
      'https://a.gov/x': hop(301, { location: 'https://a.gov/y' }),
      'https://a.gov/y': hop(405),
    })
    const link = await checkLink.execute({ url: 'https://a.gov/x' }, ctx)
    expect(link).toEqual({
      ok: true,
      url: 'https://a.gov/x',
      status: 405,
      finalUrl: 'https://a.gov/y',
    })
    expect(vi.mocked(web.request).mock.calls.map((call) => call[0])).toEqual([
      'HEAD',
      'HEAD',
    ])
  })
})
