import { Inject, Injectable, Optional } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { AgentBrowserService } from './agentBrowser.service'
import { AgentPageReplayService, normalizeReplayUrl } from './judgeReplay'
import type { ToolContext } from './tool'
import {
  AGENT_WEB_HTTP,
  type AgentWebHttp,
  defaultAgentWebHttp,
  literalHostBlocked,
} from './webHttp'
import {
  documentKind,
  type DocumentKind,
  documentPages,
  looksLikeHtml,
  markdownFromHtml,
  needsBrowser,
} from './webText'

const MAX_CACHED_DOCUMENTS_PER_RUN = 8
const MAX_CACHED_PAGES_PER_RUN = 20

export type WebFailureReason =
  | 'invalid_url'
  | 'blocked_host'
  | 'timeout'
  | 'fetch_failed'
  | 'http_error'
  | 'too_large'
  | 'unsupported_content_type'
  | 'not_a_document'
  | 'unreadable_document'

export type WebFailure = {
  ok: false
  reason: WebFailureReason
  status?: number
  detail?: string
}

export type WebResource = {
  ok: true
  via: 'replay' | 'http' | 'browser'
  status: number
  contentType: string
  finalUrl: string
  body: Buffer
}

export type WebDocument = {
  ok: true
  url: string
  finalUrl: string
  kind: DocumentKind
  via: WebResource['via']
  pages: string[]
}

export type WebPage =
  | { ok: true; kind: 'text'; resource: WebResource; text: string }
  | { ok: true; kind: 'document'; document: WebDocument }

export type WebLink =
  | { ok: true; via: 'replay' | 'http'; status: number; finalUrl: string }
  | WebFailure

const baseType = (contentType: string) =>
  contentType.split(';')[0]?.trim().toLowerCase() ?? ''

// The web as the agent tools see it: a judge replay first, then plain HTTP
// behind gp-api's SSRF guard, then the run's remote browser when the page
// needs JavaScript or the site turns plain clients away. Expected failures
// come back as values, never throws, so one bad URL doesn't end a run.
@Injectable()
export class AgentWebService {
  private readonly documents = new Map<
    string,
    Map<string, Promise<WebDocument | WebFailure>>
  >()
  private readonly pages = new Map<string, Map<string, WebPage>>()

  constructor(
    private readonly logger: PinoLogger,
    private readonly replay: AgentPageReplayService,
    private readonly browser: AgentBrowserService,
    @Optional()
    @Inject(AGENT_WEB_HTTP)
    private readonly http: AgentWebHttp = defaultAgentWebHttp,
  ) {}

  async endRun(runId: string): Promise<void> {
    this.documents.delete(runId)
    this.pages.delete(runId)
    await this.browser.endRun(runId)
  }

  async load(ctx: ToolContext, url: string): Promise<WebResource | WebFailure> {
    const invalid = this.checkUrl(url)
    if (invalid) return invalid

    const replayed = await this.replay.lookupFetch(ctx.runId, url)
    if (replayed) return { ok: true, via: 'replay', ...replayed }

    const fetched = await this.http.get(url, ctx.signal)
    let plain: WebResource | undefined
    if (fetched.kind === 'error') {
      if (fetched.reason === 'blocked_host' || fetched.reason === 'too_large') {
        return { ok: false, reason: fetched.reason }
      }
    } else {
      const contentType = baseType(fetched.contentType ?? '')
      plain = {
        ok: true,
        via: 'http',
        status: fetched.status,
        contentType,
        finalUrl: fetched.finalUrl,
        body: fetched.body,
      }
      const blocked = [403, 429, 503].includes(fetched.status)
      if (!blocked && (fetched.status < 200 || fetched.status >= 300)) {
        return { ok: false, reason: 'http_error', status: fetched.status }
      }
      const isHtml = contentType.includes('html')
      if (!blocked && !isHtml) return plain
      if (!blocked) {
        const html = fetched.body.toString('utf8')
        const markdown = markdownFromHtml(html, fetched.finalUrl)
        if (!needsBrowser(fetched.status, html, markdown)) return plain
      }
    }

    const rendered = await this.browser
      .render(ctx.runId, url, ctx.signal)
      .catch((err: unknown) => {
        this.logger.warn(
          { runId: ctx.runId, err },
          'agent browser unavailable, using the plain fetch',
        )
        return undefined
      })
    if (rendered?.kind === 'page') {
      return {
        ok: true,
        via: 'browser',
        status: rendered.status,
        contentType: 'text/html',
        finalUrl: rendered.finalUrl,
        body: Buffer.from(rendered.html, 'utf8'),
      }
    }
    if (rendered?.kind === 'download') {
      return {
        ok: true,
        via: 'browser',
        status: 200,
        contentType: rendered.contentType,
        finalUrl: rendered.finalUrl,
        body: rendered.body,
      }
    }
    if (plain && plain.status >= 200 && plain.status < 300) return plain
    if (rendered?.kind === 'error' && rendered.reason !== 'navigation_failed') {
      return { ok: false, reason: rendered.reason }
    }
    if (plain) return { ok: false, reason: 'http_error', status: plain.status }
    return {
      ok: false,
      reason:
        fetched.kind === 'error' && fetched.reason === 'timeout'
          ? 'timeout'
          : 'fetch_failed',
      detail: rendered?.kind === 'error' ? rendered.detail : undefined,
    }
  }

  // A model reads a long page in slices, so a continuing read is served from
  // the run's copy instead of fetching and rendering the page again.
  async page(
    ctx: ToolContext,
    url: string,
    continuing = false,
  ): Promise<WebPage | WebFailure> {
    const key = normalizeReplayUrl(url)
    let cache = this.pages.get(ctx.runId)
    const cached = cache?.get(key)
    if (continuing && cached) return cached
    const page = await this.loadPage(ctx, url)
    if (page.ok) {
      if (!cache) {
        cache = new Map()
        this.pages.set(ctx.runId, cache)
      }
      cache.delete(key)
      cache.set(key, page)
      const oldest = cache.keys().next().value
      if (cache.size > MAX_CACHED_PAGES_PER_RUN && oldest !== undefined) {
        cache.delete(oldest)
      }
    }
    return page
  }

  private async loadPage(
    ctx: ToolContext,
    url: string,
  ): Promise<WebPage | WebFailure> {
    const resource = await this.load(ctx, url)
    if (!resource.ok) return resource
    const kind = documentKind(resource.contentType, resource.body, url)
    if (kind) {
      const document = await this.cachedDocument(ctx.runId, url, async () =>
        this.parse(url, resource, kind),
      )
      return document.ok ? { ok: true, kind: 'document', document } : document
    }
    const body = resource.body.toString('utf8')
    if (resource.contentType.includes('html')) {
      // The broker records a rendered page as its visible text under its
      // original content type, so a replayed "HTML" body may be plain text.
      const text = looksLikeHtml(body)
        ? markdownFromHtml(body, resource.finalUrl)
        : body.trim()
      return { ok: true, kind: 'text', resource, text }
    }
    if (
      /^(text\/|application\/(json|xml|ld\+json))/.test(resource.contentType)
    ) {
      return { ok: true, kind: 'text', resource, text: body.trim() }
    }
    return {
      ok: false,
      reason: 'unsupported_content_type',
      detail: resource.contentType || 'unknown content type',
    }
  }

  async document(
    ctx: ToolContext,
    url: string,
  ): Promise<WebDocument | WebFailure> {
    return this.cachedDocument(ctx.runId, url, async () => {
      const resource = await this.load(ctx, url)
      if (!resource.ok) return resource
      const kind = documentKind(resource.contentType, resource.body, url)
      if (!kind) {
        return {
          ok: false,
          reason: 'not_a_document',
          detail: `${resource.contentType || 'unknown content type'}; use fetchPage for web pages`,
        }
      }
      return this.parse(url, resource, kind)
    })
  }

  async link(ctx: ToolContext, url: string): Promise<WebLink> {
    const invalid = this.checkUrl(url)
    if (invalid) return invalid
    const replayed = await this.replay.lookupHead(ctx.runId, url)
    if (replayed) return { ok: true, via: 'replay', ...replayed }
    const head = await this.http.head(url, ctx.signal)
    if (head.kind === 'ok' && ![405, 501].includes(head.status)) {
      return { ok: true, via: 'http', ...head }
    }
    if (head.kind === 'error' && head.reason !== 'network') {
      return { ok: false, reason: head.reason }
    }
    const fetched = await this.http.get(url, ctx.signal)
    if (fetched.kind === 'error') {
      return {
        ok: false,
        reason: fetched.reason === 'network' ? 'fetch_failed' : fetched.reason,
      }
    }
    return {
      ok: true,
      via: 'http',
      status: fetched.status,
      finalUrl: fetched.finalUrl,
    }
  }

  private checkUrl(url: string): WebFailure | undefined {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, reason: 'invalid_url' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'invalid_url' }
    }
    if (literalHostBlocked(parsed.hostname)) {
      return { ok: false, reason: 'blocked_host' }
    }
    return undefined
  }

  private async parse(
    url: string,
    resource: WebResource,
    kind: DocumentKind,
  ): Promise<WebDocument | WebFailure> {
    try {
      return {
        ok: true,
        url,
        finalUrl: resource.finalUrl,
        kind,
        via: resource.via,
        pages: await documentPages(kind, resource.body),
      }
    } catch (err) {
      return {
        ok: false,
        reason: 'unreadable_document',
        detail: err instanceof Error ? err.message : undefined,
      }
    }
  }

  // Parsed text, not bytes, is kept per run, so paging through a packet or
  // searching it again doesn't refetch or reparse it.
  private cachedDocument(
    runId: string,
    url: string,
    produce: () => Promise<WebDocument | WebFailure>,
  ): Promise<WebDocument | WebFailure> {
    const key = normalizeReplayUrl(url)
    let cache = this.documents.get(runId)
    if (!cache) {
      cache = new Map()
      this.documents.set(runId, cache)
    }
    const existing = cache.get(key)
    if (existing) return existing
    const produced = produce()
    cache.set(key, produced)
    void produced.then((result) => {
      if (!result.ok) cache.delete(key)
    })
    while (cache.size > MAX_CACHED_DOCUMENTS_PER_RUN) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    return produced
  }
}
