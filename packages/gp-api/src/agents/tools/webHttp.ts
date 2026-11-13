import * as http from 'http'
import * as https from 'https'
import axios from 'axios'
import { z } from 'zod'
import {
  assertPublicHostname,
  isPublicAddress,
  ssrfSafeLookup,
} from '@/websites/util/ssrf.util'

export const AGENT_WEB_HTTP = 'AGENT_WEB_HTTP'
export const AGENT_URL_GUARD = 'AGENT_URL_GUARD'

const FETCH_TIMEOUT_MS = 30_000
// Agenda packets run large (a real CivicWeb packet is 77 MB). The broker
// allows 250 MB, but the whole body is held in memory here.
export const MAX_FETCH_BYTES = 100 * 1024 * 1024

// Same browser user agent as the broker, so plain fetches look like the
// rendered ones that sites already allow.
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export type HttpFetchResult =
  | {
      kind: 'ok'
      status: number
      contentType: string | null
      body: Buffer
      finalUrl: string
    }
  | {
      kind: 'error'
      reason: 'timeout' | 'blocked_host' | 'network' | 'too_large'
    }

export type HttpHeadResult =
  | { kind: 'ok'; status: number; finalUrl: string }
  | { kind: 'error'; reason: 'timeout' | 'blocked_host' | 'network' }

export type AgentWebHttp = {
  get: (url: string, signal: AbortSignal) => Promise<HttpFetchResult>
  head: (url: string, signal: AbortSignal) => Promise<HttpHeadResult>
}

export type AgentUrlGuard = (url: string) => Promise<boolean>

export const literalHostBlocked = (hostname: string): boolean => {
  const bare = hostname.replace(/^\[|\]$/g, '')
  if (bare === 'localhost') return true
  const looksLikeIp = /^[\d.]+$/.test(bare) || bare.includes(':')
  return looksLikeIp && !isPublicAddress(bare)
}

// The guard for URLs a browser will open. The connect-time lookup that
// protects plain fetches can't reach inside a browser, so the host is
// resolved and checked up front.
export const defaultAgentUrlGuard: AgentUrlGuard = async (url) => {
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol !== 'http:' && protocol !== 'https:') return false
    if (literalHostBlocked(hostname)) return false
    await assertPublicHostname(hostname)
    return true
  } catch {
    return false
  }
}

// Node skips a custom agent lookup for IP-literal hosts, so a redirect
// straight to a private IP is re-checked on every hop.
const guardRedirect = (options: { hostname?: string }): void => {
  if (options.hostname && literalHostBlocked(options.hostname)) {
    throw new Error('Refusing to follow redirect to non-public IP')
  }
}

const RedirectedRequestSchema = z.object({
  res: z.object({ responseUrl: z.string().optional() }).optional(),
})

const finalUrlFrom = (request: unknown, requestedUrl: string): string => {
  const parsed = RedirectedRequestSchema.safeParse(request)
  return parsed.success
    ? (parsed.data.res?.responseUrl ?? requestedUrl)
    : requestedUrl
}

const errorReason = (err: unknown) => {
  const message = err instanceof Error ? err.message : ''
  if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') {
    return 'timeout' as const
  }
  if (message.includes('non-public IP')) return 'blocked_host' as const
  if (message.includes('maxContentLength size')) return 'too_large' as const
  return 'network' as const
}

const requestOptions = (signal: AbortSignal) => ({
  timeout: FETCH_TIMEOUT_MS,
  signal,
  validateStatus: () => true,
  maxRedirects: 5,
  beforeRedirect: guardRedirect,
  headers: {
    'User-Agent': BROWSER_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8',
  },
  httpAgent: new http.Agent({ lookup: ssrfSafeLookup }),
  httpsAgent: new https.Agent({ lookup: ssrfSafeLookup }),
})

export const defaultAgentWebHttp: AgentWebHttp = {
  get: async (url, signal) => {
    try {
      const res = await axios.get<ArrayBuffer>(url, {
        ...requestOptions(signal),
        responseType: 'arraybuffer',
        maxContentLength: MAX_FETCH_BYTES,
        maxBodyLength: MAX_FETCH_BYTES,
      })
      const rawType = res.headers['content-type']
      return {
        kind: 'ok',
        status: res.status,
        contentType: typeof rawType === 'string' ? rawType : null,
        body: Buffer.from(res.data),
        finalUrl: finalUrlFrom(res.request, url),
      }
    } catch (err) {
      return { kind: 'error', reason: errorReason(err) }
    }
  },
  head: async (url, signal) => {
    try {
      const res = await axios.head(url, requestOptions(signal))
      return {
        kind: 'ok',
        status: res.status,
        finalUrl: finalUrlFrom(res.request, url),
      }
    } catch (err) {
      const reason = errorReason(err)
      return {
        kind: 'error',
        reason: reason === 'too_large' ? 'network' : reason,
      }
    }
  },
}
