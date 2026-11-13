import { mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common'
import { tools as playwrightTools } from 'playwright-core/lib/coreBundle'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { PinoLogger } from 'nestjs-pino'
import { startAgentCoreBrowserSession } from './agentCoreBrowser'
import {
  AGENT_URL_GUARD,
  type AgentUrlGuard,
  BROWSER_USER_AGENT,
  defaultAgentUrlGuard,
  MAX_FETCH_BYTES,
} from './webHttp'

const NAVIGATION_TIMEOUT_MS = 45_000
const INITIAL_DOWNLOAD_GRACE_MS = 800
const DOWNLOAD_WAIT_MS = 30_000
const SETTLE_MS = 3_000
const IDLE_CLOSE_MS = 10 * 60 * 1000
const MAX_TOOL_OUTPUT_CHARS = 40_000

export type BrowserRenderResult =
  | { kind: 'page'; status: number; finalUrl: string; html: string }
  | {
      kind: 'download'
      finalUrl: string
      contentType: string
      body: Buffer
    }
  | {
      kind: 'error'
      reason: 'blocked_host' | 'navigation_failed' | 'too_large'
      detail?: string
    }

type RunBrowser = {
  browser: Browser
  stop: () => Promise<void>
  toolContext?: BrowserContext
  toolClient?: Client
  outputDir: string
  lastUsed: number
}

type CapturedDownload =
  | { kind: 'body'; finalUrl: string; contentType: string; body: Buffer }
  | { kind: 'too_large' }

type RequestPaused = {
  requestId: string
  frameId: string
  request: { url: string }
  responseStatusCode?: number
  responseHeaders?: { name: string; value: string }[]
}

const isTextual = (contentType: string) =>
  /^(text\/|application\/(xhtml\+xml|json|xml|ld\+json))/.test(contentType)

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// One remote browser per agent run, reused across its tool calls, in place
// of the broker's Chromium. AgentCore Browser by default;
// AGENT_BROWSER_CDP_URL points it at any other CDP endpoint instead (a local
// Chromium for development and tests). gp-api runs no browser itself.
//
// Engines call endRun when a run finishes. A run that stops without it (a
// killed task) has its session closed after ten idle minutes, and AgentCore
// times the session out an hour after it started.
@Injectable()
export class AgentBrowserService implements OnModuleDestroy {
  private readonly runs = new Map<string, Promise<RunBrowser>>()
  private readonly idleSweep: NodeJS.Timeout

  constructor(
    private readonly logger: PinoLogger,
    @Optional()
    @Inject(AGENT_URL_GUARD)
    private readonly urlGuard: AgentUrlGuard = defaultAgentUrlGuard,
  ) {
    this.idleSweep = setInterval(() => void this.closeIdle(), 60_000)
    this.idleSweep.unref()
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.idleSweep)
    await Promise.all([...this.runs.keys()].map((runId) => this.endRun(runId)))
  }

  async endRun(runId: string): Promise<void> {
    const pending = this.runs.get(runId)
    if (!pending) return
    this.runs.delete(runId)
    const run = await pending.catch(() => undefined)
    if (!run) return
    await run.toolClient?.close().catch(() => undefined)
    await run.browser.close().catch(() => undefined)
    await run
      .stop()
      .catch((err: unknown) =>
        this.logger.warn({ runId, err }, 'agent browser session stop failed'),
      )
    await rm(run.outputDir, { recursive: true, force: true })
  }

  // Opens the URL in a fresh context, the way the broker renders a fetch.
  // A response the browser would download (an attachment, a PDF) is taken
  // off the wire over CDP and returned as bytes: the browser's downloads land
  // on the remote machine, where Playwright can't read them.
  async render(
    runId: string,
    url: string,
    signal: AbortSignal,
  ): Promise<BrowserRenderResult> {
    if (!(await this.urlGuard(url))) {
      return { kind: 'error', reason: 'blocked_host' }
    }
    const run = await this.runFor(runId)
    const context = await run.browser.newContext({
      userAgent: BROWSER_USER_AGENT,
      viewport: { width: 1280, height: 800 },
    })
    const closeOnAbort = () => void context.close().catch(() => undefined)
    signal.addEventListener('abort', closeOnAbort, { once: true })
    try {
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      const { frameTree } = await cdp.send('Page.getFrameTree')
      let captured: CapturedDownload | undefined

      const capture = async (event: RequestPaused) => {
        const headers = Object.fromEntries(
          (event.responseHeaders ?? []).map((h) => [
            h.name.toLowerCase(),
            h.value,
          ]),
        )
        const contentType = (
          (headers['content-type'] ?? '').split(';')[0] ?? ''
        )
          .trim()
          .toLowerCase()
        const status = event.responseStatusCode ?? 0
        // Only the page's own document: a PDF in an iframe is part of the
        // page, not a download.
        const isDownload =
          event.frameId === frameTree.frame.id &&
          status >= 200 &&
          status < 300 &&
          !captured &&
          (/attachment/i.test(headers['content-disposition'] ?? '') ||
            (contentType !== '' && !isTextual(contentType)))
        if (!isDownload) {
          await cdp.send('Fetch.continueRequest', {
            requestId: event.requestId,
          })
          return
        }
        if (Number(headers['content-length'] ?? 0) > MAX_FETCH_BYTES) {
          captured = { kind: 'too_large' }
        } else {
          const { stream } = await cdp.send('Fetch.takeResponseBodyAsStream', {
            requestId: event.requestId,
          })
          const chunks: Buffer[] = []
          let size = 0
          for (;;) {
            const chunk = await cdp.send('IO.read', {
              handle: stream,
              size: 4 * 1024 * 1024,
            })
            const bytes = Buffer.from(
              chunk.data,
              chunk.base64Encoded ? 'base64' : 'utf8',
            )
            size += bytes.length
            if (size > MAX_FETCH_BYTES) break
            chunks.push(bytes)
            if (chunk.eof) break
          }
          await cdp.send('IO.close', { handle: stream })
          captured =
            size > MAX_FETCH_BYTES
              ? { kind: 'too_large' }
              : {
                  kind: 'body',
                  finalUrl: event.request.url,
                  contentType: contentType || 'application/octet-stream',
                  body: Buffer.concat(chunks),
                }
        }
        await cdp.send('Fetch.failRequest', {
          requestId: event.requestId,
          errorReason: 'Aborted',
        })
      }

      cdp.on('Fetch.requestPaused', (event) => {
        capture(event).catch((err: unknown) => {
          this.logger.warn({ runId, err }, 'agent browser capture failed')
          void cdp
            .send('Fetch.continueRequest', { requestId: event.requestId })
            .catch(() => undefined)
        })
      })
      await cdp.send('Fetch.enable', {
        patterns: [
          {
            urlPattern: '*',
            resourceType: 'Document',
            requestStage: 'Response',
          },
        ],
      })

      let status: number | undefined
      let navError: string | undefined
      try {
        const response = await page.goto(url, {
          timeout: NAVIGATION_TIMEOUT_MS,
        })
        status = response?.status()
      } catch (err) {
        navError = err instanceof Error ? err.message.split('\n')[0] : 'error'
      }

      // A bot challenge often triggers its download a few hundred ms after
      // navigation settles, and a failed navigation is usually a download
      // still arriving.
      const waitMs =
        navError !== undefined ? DOWNLOAD_WAIT_MS : INITIAL_DOWNLOAD_GRACE_MS
      for (let waited = 0; !captured && waited < waitMs; waited += 100) {
        if (signal.aborted) break
        await wait(100)
      }
      if (!captured && navError === undefined) {
        await page
          .waitForLoadState('networkidle', { timeout: SETTLE_MS })
          .catch(() => undefined)
      }

      if (captured?.kind === 'too_large') {
        return { kind: 'error', reason: 'too_large' }
      }
      if (captured) {
        if (!(await this.urlGuard(captured.finalUrl))) {
          return { kind: 'error', reason: 'blocked_host' }
        }
        const { finalUrl, contentType, body } = captured
        return { kind: 'download', finalUrl, contentType, body }
      }
      if (navError !== undefined || status === undefined) {
        return { kind: 'error', reason: 'navigation_failed', detail: navError }
      }
      const finalUrl = page.url()
      if (!(await this.urlGuard(finalUrl))) {
        return { kind: 'error', reason: 'blocked_host' }
      }
      return { kind: 'page', status, finalUrl, html: await page.content() }
    } catch (err) {
      return {
        kind: 'error',
        reason: 'navigation_failed',
        detail: err instanceof Error ? err.message.split('\n')[0] : undefined,
      }
    } finally {
      signal.removeEventListener('abort', closeOnAbort)
      await context.close().catch(() => undefined)
    }
  }

  // Playwright MCP's own tools, served in-process against the run's browser
  // over an in-memory MCP transport. The tab persists across calls, so a
  // model can navigate, snapshot, then click a ref from that snapshot.
  async callBrowserTool(
    runId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; text: string }> {
    if (name === 'browser_navigate' && typeof args.url === 'string') {
      if (!(await this.urlGuard(args.url))) {
        return { ok: false, text: 'blocked_host: that URL is not public' }
      }
    }
    let run: RunBrowser
    try {
      run = await this.runFor(runId)
    } catch (err) {
      this.logger.warn({ runId, err }, 'agent browser unavailable')
      return { ok: false, text: 'browser_unavailable: try fetchPage instead' }
    }
    if (!run.toolClient) {
      const toolContext = await run.browser.newContext({
        userAgent: BROWSER_USER_AGENT,
        viewport: { width: 1280, height: 800 },
      })
      const server = await playwrightTools.createConnection(
        {
          browser: { isolated: false },
          outputDir: run.outputDir,
          outputMode: 'stdout',
          codegen: 'none',
          imageResponses: 'omit',
          snapshot: { mode: 'none' },
        },
        async () => toolContext,
      )
      const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
      await server.connect(serverSide)
      const client = new Client({ name: 'gp-api-agent', version: '1.0.0' })
      await client.connect(clientSide)
      run.toolContext = toolContext
      run.toolClient = client
    }
    const result = await run.toolClient.callTool({ name, arguments: args })
    const content = Array.isArray(result.content) ? result.content : []
    const text = content
      .map((part: { type?: string; text?: string }) =>
        part.type === 'text' ? (part.text ?? '') : '',
      )
      .join('\n')
    return {
      ok: result.isError !== true,
      text:
        text.length > MAX_TOOL_OUTPUT_CHARS
          ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[truncated]`
          : text,
    }
  }

  private runFor(runId: string): Promise<RunBrowser> {
    const existing = this.runs.get(runId)
    if (existing) {
      return existing.then((run) => {
        run.lastUsed = Date.now()
        return run
      })
    }
    const created = this.connect(runId)
    this.runs.set(runId, created)
    created.catch(() => this.runs.delete(runId))
    return created
  }

  private async connect(runId: string): Promise<RunBrowser> {
    const outputDir = join(tmpdir(), 'agent-browser', runId)
    await mkdir(outputDir, { recursive: true })
    const cdpUrl = process.env.AGENT_BROWSER_CDP_URL
    if (cdpUrl) {
      const browser = await chromium.connectOverCDP(cdpUrl)
      return {
        browser,
        stop: async () => undefined,
        outputDir,
        lastUsed: Date.now(),
      }
    }
    const session = await startAgentCoreBrowserSession(runId)
    try {
      const browser = await chromium.connectOverCDP(session.wsUrl, {
        headers: session.headers,
      })
      this.logger.info(
        { runId, sessionId: session.sessionId },
        'agent browser session started',
      )
      return { browser, stop: session.stop, outputDir, lastUsed: Date.now() }
    } catch (err) {
      await session.stop().catch(() => undefined)
      throw err
    }
  }

  private async closeIdle(): Promise<void> {
    const now = Date.now()
    for (const [runId, pending] of this.runs) {
      const run = await pending.catch(() => undefined)
      if (run && now - run.lastUsed > IDLE_CLOSE_MS) await this.endRun(runId)
    }
  }
}
