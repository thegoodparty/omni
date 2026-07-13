import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import axios from 'axios'
import { z } from 'zod'

export const MAX_SEARCH_RESULTS = 8
const SEARCH_TIMEOUT_MS = 10_000
export const MAX_DESCRIPTION_CHARS = 600
const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search'

export type OrdinanceSearchHttpResult =
  | { kind: 'ok'; status: number; body: string }
  | { kind: 'error'; reason: 'timeout' | 'network' }

export interface OrdinanceSearchHttp {
  get(
    url: string,
    headers: Record<string, string>,
  ): Promise<OrdinanceSearchHttpResult>
}

export const ORDINANCE_SEARCH_HTTP = 'ORDINANCE_SEARCH_HTTP'

export interface OrdinanceSearchHit {
  title: string
  url: string
  description: string
  extraSnippets?: string[]
  age?: string
}

export type OrdinanceSearchResult =
  | { ok: true; query: string; results: OrdinanceSearchHit[] }
  | {
      ok: false
      reason: 'not_configured' | 'timeout' | 'http_error' | 'search_failed'
      status?: number
    }

export const defaultOrdinanceSearchHttp: OrdinanceSearchHttp = {
  get: async (url, headers) => {
    try {
      const res = await axios.get<string>(url, {
        timeout: SEARCH_TIMEOUT_MS,
        responseType: 'text',
        transformResponse: [(data: string) => data],
        validateStatus: () => true,
        maxContentLength: 5 * 1024 * 1024,
        maxBodyLength: 5 * 1024 * 1024,
        headers,
      })
      return {
        kind: 'ok',
        status: res.status,
        body: typeof res.data === 'string' ? res.data : '',
      }
    } catch (err) {
      if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') {
        return { kind: 'error', reason: 'timeout' }
      }
      return { kind: 'error', reason: 'network' }
    }
  },
}

const BraveResponseSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string().optional(),
            url: z.string().optional(),
            description: z.string().optional(),
            extra_snippets: z.array(z.string()).optional(),
            page_age: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
})

const braveHttpErrorMsg = (status: number): string =>
  status === 401 || status === 403
    ? 'Brave search auth failed — check BRAVE_API_KEY'
    : status === 429
      ? 'Brave search rate-limited/quota exhausted'
      : 'Brave search returned non-2xx'

// Brave Web Search for the ordinance-flow agent: turns a query into ranked,
// fetchable result URLs (unlike Anthropic's native web_search, which hides the
// URLs). Expected failures return error-shaped results instead of throwing — a
// thrown tool error kills the whole chat stream.
@Injectable()
export class OrdinanceFlowSearchService {
  private readonly logger = new Logger(OrdinanceFlowSearchService.name)

  constructor(
    @Optional()
    @Inject(ORDINANCE_SEARCH_HTTP)
    private readonly http: OrdinanceSearchHttp = defaultOrdinanceSearchHttp,
    @Optional()
    private readonly apiKey: string = process.env.BRAVE_API_KEY ?? '',
  ) {}

  async search(
    query: string,
    count: number = MAX_SEARCH_RESULTS,
  ): Promise<OrdinanceSearchResult> {
    if (!this.apiKey) return { ok: false, reason: 'not_configured' }

    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(count, MAX_SEARCH_RESULTS)),
      extra_snippets: 'true',
    })

    let res: OrdinanceSearchHttpResult
    try {
      res = await this.http.get(`${BRAVE_SEARCH_URL}?${params.toString()}`, {
        Accept: 'application/json',
        'X-Subscription-Token': this.apiKey,
      })
    } catch {
      return { ok: false, reason: 'search_failed' }
    }
    if (res.kind === 'error') {
      this.logger.warn(
        { reason: res.reason, query },
        'Brave search transport failure',
      )
      return {
        ok: false,
        reason: res.reason === 'timeout' ? 'timeout' : 'search_failed',
      }
    }
    if (res.status < 200 || res.status >= 300) {
      this.logger.warn(
        { status: res.status, query },
        braveHttpErrorMsg(res.status),
      )
      return { ok: false, reason: 'http_error', status: res.status }
    }

    let parsed: z.infer<typeof BraveResponseSchema>
    try {
      const result = BraveResponseSchema.safeParse(JSON.parse(res.body))
      if (!result.success) {
        this.logger.warn(
          { err: result.error, query },
          'Brave search response failed schema parse',
        )
        return { ok: false, reason: 'search_failed' }
      }
      parsed = result.data
    } catch (err) {
      this.logger.warn({ err, query }, 'Brave search returned unparseable body')
      return { ok: false, reason: 'search_failed' }
    }

    const results = (parsed.web?.results ?? [])
      .flatMap((r) => {
        if (!r.title || !r.url) return []
        return [
          {
            title: r.title,
            url: r.url,
            description: (r.description ?? '').slice(0, MAX_DESCRIPTION_CHARS),
            ...(r.extra_snippets?.length && {
              extraSnippets: r.extra_snippets,
            }),
            ...(r.page_age && { age: r.page_age }),
          },
        ]
      })
      .slice(0, Math.min(count, MAX_SEARCH_RESULTS))
    return { ok: true, query, results }
  }
}
