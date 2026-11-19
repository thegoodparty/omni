import { lookup } from 'node:dns/promises'
import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { type Browser, chromium } from 'playwright-core'
import { isPublicAddress } from '@/websites/util/ssrf.util'
import { startAgentCoreBrowserSession } from './agentCoreBrowser'
import { MAX_BYTES, urlRefusal, USER_AGENT } from './agentWeb.service'
import type { ToolContext } from './tool'

const RENDER_DEADLINE_MS = 60_000
const NAVIGATION_TIMEOUT_MS = 45_000
const SETTLE_MS = 3_000
export const MAX_RENDERS_PER_RUN = 5

export type RenderedPage =
  | { blocked: true }
  | { blocked: false; status: number; finalUrl: string; html: string }

// One AgentCore Browser session, opened for one render. `navigate` asks
// `hopAllowed` before the browser requests each document, the redirect hops
// included, and refuses the hop when it says no.
export type BrowserSession = {
  navigate: (
    url: string,
    hopAllowed: (url: string) => Promise<boolean>,
  ) => Promise<RenderedPage>
  stop: () => Promise<void>
}

export type RenderFailure = {
  ok: false
  reason:
    | 'invalid_url'
    | 'blocked_host'
    | 'render_limit'
    | 'browser_unavailable'
    | 'timeout'
    | 'aborted'
    | 'too_large'
    | 'render_failed'
}

export type RenderResult =
  | { ok: true; status: number; finalUrl: string; html: string }
  | RenderFailure

// Exported for its test: the CDP request interception is the redirect guard.
export const navigateInBrowser = async (
  browser: Browser,
  url: string,
  allowed: (url: string) => Promise<boolean>,
): Promise<RenderedPage> => {
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  let blocked = false
  cdp.on('Fetch.requestPaused', (event) => {
    const requestId = event.requestId
    allowed(event.request.url)
      .then((ok) => {
        if (ok) return cdp.send('Fetch.continueRequest', { requestId })
        blocked = true
        return cdp.send('Fetch.failRequest', {
          requestId,
          errorReason: 'BlockedByClient',
        })
      })
      .catch(() => undefined)
  })
  await cdp.send('Fetch.enable', {
    patterns: [
      {
        urlPattern: '*',
        resourceType: 'Document',
        requestStage: 'Request',
      },
    ],
  })
  let status: number | undefined
  try {
    const response = await page.goto(url, {
      waitUntil: 'load',
      timeout: NAVIGATION_TIMEOUT_MS,
    })
    status = response?.status()
  } catch (err) {
    if (blocked) return { blocked: true }
    throw err
  }
  if (blocked) return { blocked: true }
  await page
    .waitForLoadState('networkidle', { timeout: SETTLE_MS })
    .catch(() => undefined)
  if (blocked) return { blocked: true }
  return {
    blocked: false,
    status: status ?? 0,
    finalUrl: page.url(),
    html: await page.content(),
  }
}

class RenderDeadlineError extends Error {}

export const hopAllowed = async (url: string): Promise<boolean> => {
  if (urlRefusal(url)) return false
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '')
  const addresses = await lookup(hostname, { all: true }).catch(() => [])
  return addresses.every(({ address }) => isPublicAddress(address))
}

// The last-resort browser for a page plain HTTP could not read. Every render
// opens its own AgentCore session and stops it before returning. A run's
// renders queue behind each other, so it holds one session at a time, and a
// run gets MAX_RENDERS_PER_RUN of them.
// Counts live in this process, so a run resumed on another task starts over.
@Injectable()
export class AgentBrowserService {
  renderDeadlineMs = RENDER_DEADLINE_MS
  private readonly rendersByRun = new Map<string, number>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly logger: PinoLogger) {}

  async render(ctx: ToolContext, url: string): Promise<RenderResult> {
    const refused = urlRefusal(url)
    if (refused) {
      return {
        ok: false,
        reason:
          refused.reason === 'blocked_host' ? 'blocked_host' : 'invalid_url',
      }
    }
    if (!(await hopAllowed(url))) return { ok: false, reason: 'blocked_host' }
    const used = this.rendersByRun.get(ctx.runId) ?? 0
    if (used >= MAX_RENDERS_PER_RUN) {
      return { ok: false, reason: 'render_limit' }
    }
    this.rendersByRun.set(ctx.runId, used + 1)
    const previous = this.queues.get(ctx.runId) ?? Promise.resolve()
    const mine = previous.then(() => this.renderInSession(ctx, url))
    const settled = mine.catch(() => undefined)
    this.queues.set(ctx.runId, settled)
    try {
      return await mine
    } finally {
      if (this.queues.get(ctx.runId) === settled) this.queues.delete(ctx.runId)
    }
  }

  private async renderInSession(
    ctx: ToolContext,
    url: string,
  ): Promise<RenderResult> {
    if (ctx.signal.aborted) return { ok: false, reason: 'aborted' }
    const deadline = AbortSignal.timeout(this.renderDeadlineMs)
    const signal = AbortSignal.any([ctx.signal, deadline])
    const ended = new Promise<never>((_, reject) => {
      signal.addEventListener(
        'abort',
        () =>
          reject(deadline.aborted ? new RenderDeadlineError() : signal.reason),
        { once: true },
      )
    })
    ended.catch(() => undefined)

    let session: BrowserSession | undefined
    const opening = this.openSession(ctx.runId)
    try {
      session = await Promise.race([opening, ended])
    } catch (err) {
      void opening.then(
        (late) => this.stop(ctx.runId, late),
        () => undefined,
      )
      if (err instanceof RenderDeadlineError) {
        return { ok: false, reason: 'timeout' }
      }
      if (ctx.signal.aborted) return { ok: false, reason: 'aborted' }
      this.logger.warn(
        { runId: ctx.runId, err: err instanceof Error ? err.name : 'unknown' },
        'agent browser session start failed',
      )
      return { ok: false, reason: 'browser_unavailable' }
    }

    try {
      const page = await Promise.race([
        session.navigate(url, hopAllowed),
        ended,
      ])
      if (page.blocked) return { ok: false, reason: 'blocked_host' }
      if (!(await hopAllowed(page.finalUrl))) {
        return { ok: false, reason: 'blocked_host' }
      }
      if (Buffer.byteLength(page.html, 'utf8') > MAX_BYTES) {
        return { ok: false, reason: 'too_large' }
      }
      return {
        ok: true,
        status: page.status,
        finalUrl: page.finalUrl,
        html: page.html,
      }
    } catch (err) {
      if (err instanceof RenderDeadlineError) {
        return { ok: false, reason: 'timeout' }
      }
      if (ctx.signal.aborted) return { ok: false, reason: 'aborted' }
      return { ok: false, reason: 'render_failed' }
    } finally {
      await this.stop(ctx.runId, session)
    }
  }

  private async stop(runId: string, session: BrowserSession): Promise<void> {
    await session
      .stop()
      .catch((err: unknown) =>
        this.logger.warn(
          { runId, err: err instanceof Error ? err.name : 'unknown' },
          'agent browser session stop failed',
        ),
      )
  }

  // The only AgentCore call. Tests replace it.
  async openSession(runId: string): Promise<BrowserSession> {
    const session = await startAgentCoreBrowserSession(runId)
    try {
      const browser = await chromium.connectOverCDP(session.wsUrl, {
        headers: session.headers,
      })
      const stop = async () => {
        await browser.close().catch(() => undefined)
        await session.stop()
      }
      const navigate: BrowserSession['navigate'] = (url, allowed) =>
        navigateInBrowser(browser, url, allowed)
      this.logger.info(
        { runId, sessionId: session.sessionId },
        'agent browser session started',
      )
      return { navigate, stop }
    } catch (err) {
      await session.stop().catch(() => undefined)
      throw err
    }
  }
}
