import { describe, expect, it, type Mock, vi } from 'vitest'
import type { PinoLogger } from 'nestjs-pino'
import {
  AgentBrowserService,
  type BrowserSession,
  MAX_RENDERS_PER_RUN,
  type RenderedPage,
} from './agentBrowser.service'
import { AgentWebService } from './agentWeb.service'
import { fetchPage } from './fetchPage'
import type { AgentPageReplayService, AgentRunReplay } from './judgeReplay'
import { renderPage } from './renderPage'
import type { ToolContext } from './tool'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (hostname: string) =>
    hostname === 'intranet.example.org'
      ? [{ address: '10.1.2.3', family: 4 }]
      : [{ address: '93.184.216.34', family: 4 }],
  ),
}))

const ARTICLE =
  '<html><head><meta property="article:published_time" content="2026-10-02T09:00:00-04:00"></head><body><p>The council voted 5-2 on the budget.</p></body></html>'

type FakeSession = {
  open: Mock<(runId: string) => Promise<BrowserSession>>
  stopped: string[]
  hops: string[]
}

// Stands in for AgentCore: each openSession is one session, `navigate` walks
// the scripted hops through the guard the way the browser's request
// interception does.
const browserWith = (
  navigate: (
    url: string,
    hopAllowed: (url: string) => Promise<boolean>,
    hops: string[],
  ) => Promise<RenderedPage>,
) => {
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  } as unknown as PinoLogger
  const browser = new AgentBrowserService(logger)
  const stopped: string[] = []
  const hops: string[] = []
  let opened = 0
  const open = vi.fn(async (_runId: string): Promise<BrowserSession> => {
    const id = `session-${++opened}`
    return {
      navigate: (url, hopAllowed) => navigate(url, hopAllowed, hops),
      stop: async () => {
        stopped.push(id)
      },
    }
  })
  const fake: FakeSession = { open, stopped, hops }
  vi.spyOn(browser, 'openSession').mockImplementation(open)
  return { browser, fake }
}

const page =
  (finalUrl: string, html = ARTICLE, status = 200) =>
  async (
    url: string,
    hopAllowed: (url: string) => Promise<boolean>,
    hops: string[],
  ): Promise<RenderedPage> => {
    hops.push(url)
    if (!(await hopAllowed(url))) return { blocked: true }
    return { blocked: false, status, finalUrl, html }
  }

const ctxWith = (
  services: { browser: AgentBrowserService; web?: AgentWebService },
  replay?: Partial<AgentPageReplayService>,
  extra: Partial<ToolContext> = {},
): ToolContext => ({
  runId: 'run-1',
  stepKey: '0:renderPage:0',
  organizationSlug: 'org',
  signal: new AbortController().signal,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  get: ((token: unknown) => {
    if (token === AgentBrowserService) return services.browser
    if (token === AgentWebService) return services.web
    return replay
  }) as unknown as ToolContext['get'],
  ...extra,
})

describe('renderPage', () => {
  it('returns the rendered page as text with its final URL, status and date, and stops the session', async () => {
    const { browser, fake } = browserWith(page('https://news.example.com/a'))
    const result = await renderPage.execute(
      { url: 'https://news.example.com/a' },
      ctxWith({ browser }),
    )
    expect(result).toEqual({
      ok: true,
      url: 'https://news.example.com/a',
      finalUrl: 'https://news.example.com/a',
      status: 200,
      content: 'The council voted 5-2 on the budget.',
      totalChars: 36,
      truncated: false,
      published: '2026-10-02',
    })
    expect(fake.stopped).toEqual(['session-1'])
  })

  it('reads a page fetchPage was refused with a 403', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const web = new AgentWebService({} as AgentPageReplayService)
    vi.spyOn(web, 'request').mockResolvedValue({
      status: 403,
      contentType: 'text/html',
      body: Buffer.from('<p>Access denied</p>'),
    })
    const { browser } = browserWith(page('https://news.example.com/a'))
    const ctx = ctxWith({ browser, web })
    const url = 'https://news.example.com/a'

    expect(await fetchPage.execute({ url }, ctx)).toEqual({
      ok: false,
      reason: 'http_error',
      status: 403,
    })
    expect(await renderPage.execute({ url }, ctx)).toMatchObject({
      ok: true,
      content: 'The council voted 5-2 on the budget.',
    })
  })

  it.each([
    'http://10.0.0.5/admin',
    'http://localhost:3000/',
    'http://[::1]/',
    'https://intranet.example.org/',
    'file:///etc/passwd',
  ])('refuses %s before opening a session', async (url) => {
    const { browser, fake } = browserWith(page(url))
    const result = await renderPage.execute({ url }, ctxWith({ browser }))
    expect(result).toMatchObject({ ok: false })
    expect(fake.open).not.toHaveBeenCalled()
  })

  it('refuses a redirect to a private address, and stops the session', async () => {
    const { browser, fake } = browserWith(async (url, hopAllowed, hops) => {
      for (const hop of [url, 'http://169.254.169.254/latest/meta-data']) {
        hops.push(hop)
        if (!(await hopAllowed(hop))) return { blocked: true }
      }
      return { blocked: false, status: 200, finalUrl: url, html: ARTICLE }
    })
    const result = await renderPage.execute(
      { url: 'https://news.example.com/a' },
      ctxWith({ browser }),
    )
    expect(result).toEqual({ ok: false, reason: 'blocked_host' })
    expect(fake.hops).toEqual([
      'https://news.example.com/a',
      'http://169.254.169.254/latest/meta-data',
    ])
    expect(fake.stopped).toEqual(['session-1'])
  })

  it('refuses a page whose final URL resolves to a private address', async () => {
    const { browser, fake } = browserWith(page('https://intranet.example.org/'))
    const result = await renderPage.execute(
      { url: 'https://news.example.com/a' },
      ctxWith({ browser }),
    )
    expect(result).toEqual({ ok: false, reason: 'blocked_host' })
    expect(fake.stopped).toEqual(['session-1'])
  })

  it('ends a render at its deadline and stops the session', async () => {
    const { browser, fake } = browserWith(() => new Promise(() => undefined))
    browser.renderDeadlineMs = 20
    const result = await renderPage.execute(
      { url: 'https://news.example.com/slow' },
      ctxWith({ browser }),
    )
    expect(result).toEqual({ ok: false, reason: 'timeout' })
    expect(fake.stopped).toEqual(['session-1'])
  })

  it('stops the session when the browser fails', async () => {
    const { browser, fake } = browserWith(async () => {
      throw new Error('Target closed')
    })
    const result = await renderPage.execute(
      { url: 'https://news.example.com/a' },
      ctxWith({ browser }),
    )
    expect(result).toEqual({ ok: false, reason: 'render_failed' })
    expect(fake.stopped).toEqual(['session-1'])
  })

  it('returns a page with no readable text as a failure', async () => {
    const { browser } = browserWith(
      page('https://news.example.com/a', '<html><body></body></html>'),
    )
    expect(
      await renderPage.execute(
        { url: 'https://news.example.com/a' },
        ctxWith({ browser }),
      ),
    ).toEqual({ ok: false, reason: 'no_text' })
  })

  it('returns browser_unavailable when no session starts', async () => {
    const { browser, fake } = browserWith(page('https://news.example.com/a'))
    fake.open.mockRejectedValueOnce(new Error('AccessDeniedException'))
    expect(
      await renderPage.execute(
        { url: 'https://news.example.com/a' },
        ctxWith({ browser }),
      ),
    ).toEqual({ ok: false, reason: 'browser_unavailable' })
  })

  it(`allows ${MAX_RENDERS_PER_RUN} renders a run`, async () => {
    const { browser, fake } = browserWith(page('https://news.example.com/a'))
    const ctx = ctxWith({ browser })
    for (let i = 0; i < MAX_RENDERS_PER_RUN; i++) {
      expect(
        await renderPage.execute({ url: 'https://news.example.com/a' }, ctx),
      ).toMatchObject({ ok: true })
    }
    expect(
      await renderPage.execute({ url: 'https://news.example.com/a' }, ctx),
    ).toEqual({ ok: false, reason: 'render_limit' })
    expect(fake.open).toHaveBeenCalledTimes(MAX_RENDERS_PER_RUN)
    expect(
      await renderPage.execute(
        { url: 'https://news.example.com/a' },
        { ...ctx, runId: 'run-2' },
      ),
    ).toMatchObject({ ok: true })
  })

  it('holds one session at a time for a run', async () => {
    let live = 0
    let most = 0
    const { browser, fake } = browserWith(async (url) => {
      live++
      most = Math.max(most, live)
      await new Promise((resolve) => setTimeout(resolve, 10))
      live--
      return { blocked: false, status: 200, finalUrl: url, html: ARTICLE }
    })
    const ctx = ctxWith({ browser })
    const results = await Promise.all(
      ['a', 'b', 'c'].map((path) =>
        renderPage.execute({ url: `https://news.example.com/${path}` }, ctx),
      ),
    )
    expect(results).toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ])
    expect(most).toBe(1)
    expect(fake.stopped).toHaveLength(3)
  })

  it('serves a judge run the recorded page before opening a browser', async () => {
    const { browser, fake } = browserWith(page('https://news.example.com/a'))
    const judgeReplay: AgentRunReplay = {
      replay: { mode: 'replay', key: 'k' },
      judgeRunId: 'judge-1',
      issuedAt: 1,
    }
    const lookupFetch = vi.fn(async (_run: AgentRunReplay, url: string) =>
      url.endsWith('/recorded')
        ? {
            status: 200,
            contentType: 'text/html',
            finalUrl: url,
            body: Buffer.from('Recorded visible text'),
          }
        : undefined,
    )
    const ctx = ctxWith({ browser }, { lookupFetch }, { judgeReplay })

    expect(
      await renderPage.execute(
        { url: 'https://news.example.com/recorded' },
        ctx,
      ),
    ).toMatchObject({ ok: true, content: 'Recorded visible text' })
    expect(fake.open).not.toHaveBeenCalled()

    expect(
      await renderPage.execute({ url: 'https://news.example.com/live' }, ctx),
    ).toMatchObject({ ok: true })
    expect(lookupFetch).toHaveBeenCalledTimes(2)
    expect(fake.open).toHaveBeenCalledTimes(1)
  })
})
