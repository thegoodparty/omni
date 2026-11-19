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
// Resolved once per URL and remembered: the probe is one request (two when the
// first shape misses), but an arm creates a user per run, and six runs per case
// would otherwise probe six times over for an answer that cannot change
// mid-run. The PROMISE is what is stored, so the first batch of runs shares one
// probe instead of racing to make its own. A resolution that FAILS is
// forgotten, because it answered nothing: a 502 or a timeout on a cold preview
// must not decide the shape of the URL for the rest of the process.
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

// `/api` is appended only when it ANSWERS. Anything else is an arm that cannot
// be reached, and saying so is the whole point: defaulting to `/api` would send
// every later call on a gp-api origin to `/api/v1/...` and turn one bad probe
// into a run of confusing 404s.
export const resolveApiRoot = async (baseUrl: string): Promise<string> => {
  const base = baseUrl.replace(/\/$/, '')
  const remembered = roots.get(base)
  if (remembered !== undefined) return remembered

  const resolved = (async (): Promise<string> => {
    const root = await probeApiVersion(base)
    if (root.ok) return base
    const proxied = await probeApiVersion(`${base}/api`)
    if (proxied.ok) return `${base}/api`
    throw new Error(
      `Neither ${base}/v1/version nor ${base}/api/v1/version answered 200 ` +
        `(${root.status} and ${proxied.status}), so ${base} is not an arm.`,
    )
  })()

  roots.set(base, resolved)
  // The next call probes again rather than replaying a failure that may have
  // been the moment's.
  resolved.catch(() => roots.delete(base))
  return resolved
}

export const forgetResolvedApiRoots = (): void => roots.clear()
