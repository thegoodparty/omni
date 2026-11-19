import axios from 'axios'
import { vercelBypassHeaders } from '@goodparty_org/test-users'

// Where an arm's API actually lives. A webapp root proxies gp-api at `/api`
// (dev.goodparty.org, and every Vercel preview), while a gp-api origin serves
// `/v1` at its own root (gp-api-dev.goodparty.org, and a PR's gp-api preview).
// A suite's paths are relative to the API root either way, so which one an arm
// is stays a property of the URL rather than of every suite.
//
// The probe carries the Vercel bypass header, because a webapp preview is behind
// Vercel Authentication and the same secret the api client sends decides
// whether the answer is the app's or the login page's.
//
// Resolved once per URL and remembered: the probe is one request, but an arm
// creates a user per run, and six runs per case would otherwise probe six times
// over for an answer that cannot change mid-run. The PROMISE is what is stored,
// so the first batch of runs shares one probe instead of racing to make its own.
const roots = new Map<string, Promise<string>>()

export const probeTimeoutMs = 20_000

export const probeApiVersion = async (
  apiRoot: string,
): Promise<{ ok: boolean; status: number | 'no response' }> => {
  try {
    const response = await axios.get(`${apiRoot}/v1/version`, {
      timeout: probeTimeoutMs,
      validateStatus: () => true,
      headers: vercelBypassHeaders(),
    })
    return { ok: response.status === 200, status: response.status }
  } catch {
    return { ok: false, status: 'no response' }
  }
}

export const resolveApiRoot = async (baseUrl: string): Promise<string> => {
  const base = baseUrl.replace(/\/$/, '')
  const remembered = roots.get(base)
  if (remembered !== undefined) return remembered
  const resolved = probeApiVersion(base).then(({ ok }) =>
    ok ? base : `${base}/api`,
  )
  roots.set(base, resolved)
  return resolved
}

export const forgetResolvedApiRoots = (): void => roots.clear()
