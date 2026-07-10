import * as http from 'http'
import * as https from 'https'
import { Inject, Injectable, Optional } from '@nestjs/common'
import axios from 'axios'
import sanitizeHtml from 'sanitize-html'
import TurndownService from 'turndown'
import { z } from 'zod'
import {
  isPublicAddress,
  ssrfSafeLookup,
} from '@/websites/services/websites.service'

export const MAX_FETCH_CONTENT_CHARS = 24_000
const FETCH_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

export type OrdinanceFetchHttpResult =
  | {
      kind: 'ok'
      status: number
      contentType: string | null
      body: string
      finalUrl: string
    }
  | { kind: 'error'; reason: 'timeout' | 'blocked_host' | 'network' }

export interface OrdinanceFetchHttp {
  get(url: string): Promise<OrdinanceFetchHttpResult>
}

export const ORDINANCE_FETCH_HTTP = 'ORDINANCE_FETCH_HTTP'

export type OrdinanceFetchResult =
  | {
      ok: true
      status: number
      finalUrl: string
      contentType: string
      content: string
      truncated: boolean
      totalChars: number
    }
  | {
      ok: false
      reason:
        | 'invalid_url'
        | 'blocked_host'
        | 'timeout'
        | 'http_error'
        | 'unsupported_content_type'
        | 'fetch_failed'
      status?: number
      detail?: string
    }

// The redirected-to URL lives on axios's untyped request internals; parse it
// out instead of casting so a shape change degrades to the requested url.
const RedirectedRequestSchema = z.object({
  res: z.object({ responseUrl: z.string().optional() }).optional(),
})

const finalUrlFrom = (request: unknown, requestedUrl: string): string => {
  const parsed = RedirectedRequestSchema.safeParse(request)
  return parsed.success
    ? (parsed.data.res?.responseUrl ?? requestedUrl)
    : requestedUrl
}

// The connect-time ssrfSafeLookup on the agents is the real SSRF defense for
// hostname connects (covers DNS rebinding). Node skips a custom agent lookup
// entirely for IP-literal hosts, so a redirect straight to a literal private
// IP would never hit ssrfSafeLookup — beforeRedirect re-runs the synchronous
// literal-IP block on every hop to close that gap, and the initial-URL check
// in fetchUrl handles the first hop.
const guardRedirect = (options: { hostname?: string }): void => {
  if (options.hostname && literalHostBlocked(options.hostname)) {
    throw new Error(`Refusing to follow redirect to non-public IP`)
  }
}

export const defaultOrdinanceFetchHttp: OrdinanceFetchHttp = {
  get: async (url) => {
    try {
      const res = await axios.get<string>(url, {
        timeout: FETCH_TIMEOUT_MS,
        responseType: 'text',
        transformResponse: [(data: string) => data],
        validateStatus: () => true,
        maxRedirects: 5,
        beforeRedirect: guardRedirect,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_RESPONSE_BYTES,
        headers: { Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
        httpAgent: new http.Agent({ lookup: ssrfSafeLookup }),
        httpsAgent: new https.Agent({ lookup: ssrfSafeLookup }),
      })
      const rawType = res.headers['content-type']
      return {
        kind: 'ok',
        status: res.status,
        contentType: typeof rawType === 'string' ? rawType : null,
        body: typeof res.data === 'string' ? res.data : '',
        finalUrl: finalUrlFrom(res.request, url),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') {
        return { kind: 'error', reason: 'timeout' }
      }
      if (message.includes('non-public IP')) {
        return { kind: 'error', reason: 'blocked_host' }
      }
      return { kind: 'error', reason: 'network' }
    }
  },
}

// sanitize-html + turndown run synchronously and block the event loop; bound
// the input so a multi-MB page can't stall every concurrent chat stream. The
// output is capped to MAX_FETCH_CONTENT_CHARS anyway, and tag-stripping only
// shrinks text, so this ceiling never truncates content that would survive.
const MAX_HTML_CONVERT_BYTES = 1_500_000

const markdownFromHtml = (body: string): string => {
  const bounded =
    body.length > MAX_HTML_CONVERT_BYTES
      ? body.slice(0, MAX_HTML_CONVERT_BYTES)
      : body
  const cleaned = sanitizeHtml(bounded, {
    allowedTags: sanitizeHtml.defaults.allowedTags,
    allowedAttributes: { a: ['href'] },
  })
  return new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  }).turndown(cleaned)
}

const literalHostBlocked = (hostname: string): boolean => {
  const bare = hostname.replace(/^\[|\]$/g, '')
  if (bare === 'localhost') return true
  const looksLikeIp = /^[\d.]+$/.test(bare) || bare.includes(':')
  return looksLikeIp && !isPublicAddress(bare)
}

// Fetches a public web page for the ordinance-flow agent and reduces it to
// model-ready markdown. Expected failures return error-shaped results instead
// of throwing: a thrown tool error kills the whole chat stream.
@Injectable()
export class OrdinanceFlowFetchService {
  constructor(
    @Optional()
    @Inject(ORDINANCE_FETCH_HTTP)
    private readonly http: OrdinanceFetchHttp = defaultOrdinanceFetchHttp,
  ) {}

  async fetchUrl(url: string): Promise<OrdinanceFetchResult> {
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

    let res: OrdinanceFetchHttpResult
    try {
      res = await this.http.get(parsed.toString())
    } catch {
      return { ok: false, reason: 'fetch_failed' }
    }
    if (res.kind === 'error') {
      return {
        ok: false,
        reason: res.reason === 'network' ? 'fetch_failed' : res.reason,
      }
    }
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, reason: 'http_error', status: res.status }
    }

    const contentType = (res.contentType ?? '').toLowerCase()
    const isHtml =
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml')
    const isText = contentType.includes('text/plain')
    if (!isHtml && !isText) {
      return {
        ok: false,
        reason: 'unsupported_content_type',
        detail: contentType || 'unknown content type',
      }
    }

    const full = isHtml ? markdownFromHtml(res.body) : res.body
    const truncated = full.length > MAX_FETCH_CONTENT_CHARS
    return {
      ok: true,
      status: res.status,
      finalUrl: res.finalUrl,
      contentType,
      content: truncated ? full.slice(0, MAX_FETCH_CONTENT_CHARS) : full,
      truncated,
      totalChars: full.length,
    }
  }
}
