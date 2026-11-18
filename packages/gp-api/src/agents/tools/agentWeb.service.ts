import * as http from 'node:http'
import * as https from 'node:https'
import { Injectable } from '@nestjs/common'
import axios from 'axios'
import sanitizeHtml from 'sanitize-html'
import TurndownService from 'turndown'
import { isPublicAddress, ssrfSafeLookup } from '@/websites/util/ssrf.util'
import { AgentPageReplayService } from './judgeReplay'
import type { ToolContext } from './tool'

const TIMEOUT_MS = 30_000
const MAX_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 5
// The broker's browser user agent, so a plain fetch looks like the rendered
// ones sites already allow.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
// sanitize-html and turndown block the event loop; a page past this is cut
// before converting.
const MAX_HTML_CONVERT_CHARS = 1_500_000

export type WebFailure = {
  ok: false
  reason:
    | 'invalid_url'
    | 'blocked_host'
    | 'too_many_redirects'
    | 'timeout'
    | 'too_large'
    | 'fetch_failed'
}

export type WebResponse = {
  ok: true
  via: 'http' | 'replay'
  status: number
  contentType: string
  finalUrl: string
  body: Buffer
}

export type WebHead = {
  ok: true
  via: 'http' | 'replay'
  status: number
  finalUrl: string
}

// One request with redirects turned off. A 3xx comes back as is, with its
// Location, and `follow` decides whether to make the next one.
export type WebHop = {
  status: number
  location?: string
  contentType: string
  body: Buffer
}

const literalHostBlocked = (hostname: string): boolean => {
  const bare = hostname.replace(/^\[|\]$/g, '')
  if (bare === 'localhost') return true
  const looksLikeIp = /^[\d.]+$/.test(bare) || bare.includes(':')
  return looksLikeIp && !isPublicAddress(bare)
}

const urlRefusal = (url: string): WebFailure | undefined => {
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

// axios's own timeout only fires when the socket goes quiet, so a server
// that sends a byte every few seconds never trips it. Each request also has
// a deadline for the whole exchange.
export class RequestDeadlineError extends Error {}

const failureFor = (err: unknown): WebFailure => {
  if (err instanceof RequestDeadlineError) {
    return { ok: false, reason: 'timeout' }
  }
  const message = err instanceof Error ? err.message : ''
  if (message.includes('non-public IP')) {
    return { ok: false, reason: 'blocked_host' }
  }
  if (message.includes('maxContentLength')) {
    return { ok: false, reason: 'too_large' }
  }
  if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') {
    return { ok: false, reason: 'timeout' }
  }
  return { ok: false, reason: 'fetch_failed' }
}

export const baseContentType = (contentType: string): string =>
  contentType.split(';')[0]?.trim().toLowerCase() ?? ''

export const looksLikeHtml = (body: string): boolean =>
  /<(html|head|body|div|p|a|span|table|!doctype)[\s>]/i.test(
    body.slice(0, 5000),
  )

export const markdownFromHtml = (html: string): string =>
  new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
    .turndown(
      sanitizeHtml(html.slice(0, MAX_HTML_CONVERT_CHARS), {
        allowedTags: sanitizeHtml.defaults.allowedTags,
        allowedAttributes: { a: ['href'] },
      }),
    )
    .trim()

// The public web as agent tools see it: the judge's recording of the page
// when the run carries a replay ticket, else plain HTTP. Every hop of a
// redirect chain is checked before it is requested: its URL here, and the
// address its hostname resolves to by ssrfSafeLookup when the connection
// opens (Node skips that lookup for an IP literal, which is why the literal
// check runs on every hop too). Expected failures are values, not throws, so
// one bad URL does not end a run.
@Injectable()
export class AgentWebService {
  constructor(private readonly replay: AgentPageReplayService) {}

  async get(ctx: ToolContext, url: string): Promise<WebResponse | WebFailure> {
    const refused = urlRefusal(url)
    if (refused) return refused
    const replayed = ctx.judgeReplay
      ? await this.replay.lookupFetch(ctx.judgeReplay, url)
      : undefined
    if (replayed) return { ok: true, via: 'replay', ...replayed }
    const response = await this.follow('GET', url, ctx.signal)
    if (!response.ok) return response
    return { ...response, via: 'http' }
  }

  async head(ctx: ToolContext, url: string): Promise<WebHead | WebFailure> {
    const refused = urlRefusal(url)
    if (refused) return refused
    const replayed = ctx.judgeReplay
      ? await this.replay.lookupHead(ctx.judgeReplay, url)
      : undefined
    if (replayed) return { ok: true, via: 'replay', ...replayed }
    const response = await this.follow('HEAD', url, ctx.signal)
    if (!response.ok) return response
    return {
      ok: true,
      via: 'http',
      status: response.status,
      finalUrl: response.finalUrl,
    }
  }

  async follow(
    method: 'GET' | 'HEAD',
    url: string,
    signal: AbortSignal,
  ): Promise<Omit<WebResponse, 'via'> | WebFailure> {
    let current = url
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const refused = urlRefusal(current)
      if (refused) return refused
      let hop: WebHop
      try {
        hop = await this.request(method, current, signal)
      } catch (err) {
        return failureFor(err)
      }
      if (hop.status >= 300 && hop.status < 400 && hop.location) {
        try {
          current = new URL(hop.location, current).toString()
        } catch {
          return { ok: false, reason: 'invalid_url' }
        }
        continue
      }
      return {
        ok: true,
        status: hop.status,
        contentType: baseContentType(hop.contentType),
        finalUrl: current,
        body: hop.body,
      }
    }
    return { ok: false, reason: 'too_many_redirects' }
  }

  // The only network call. Tests replace it.
  async request(
    method: 'GET' | 'HEAD',
    url: string,
    signal: AbortSignal,
    deadlineMs = TIMEOUT_MS,
  ): Promise<WebHop> {
    const deadline = AbortSignal.timeout(deadlineMs)
    const res = await axios
      .request<ArrayBuffer>({
        method,
        url,
        signal: AbortSignal.any([signal, deadline]),
        timeout: deadlineMs,
        maxRedirects: 0,
        // A proxy from the environment would make the connection, so the
        // address check would see the proxy, not the page's host.
        proxy: false,
        validateStatus: () => true,
        responseType: 'arraybuffer',
        maxContentLength: MAX_BYTES,
        maxBodyLength: MAX_BYTES,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
        httpAgent: new http.Agent({ lookup: ssrfSafeLookup }),
        httpsAgent: new https.Agent({ lookup: ssrfSafeLookup }),
      })
      .catch((err: unknown) => {
        throw deadline.aborted ? new RequestDeadlineError() : err
      })
    const location: unknown = res.headers['location']
    const contentType: unknown = res.headers['content-type']
    return {
      status: res.status,
      ...(typeof location === 'string' && { location }),
      contentType: typeof contentType === 'string' ? contentType : '',
      body: Buffer.from(res.data ?? new ArrayBuffer(0)),
    }
  }
}
