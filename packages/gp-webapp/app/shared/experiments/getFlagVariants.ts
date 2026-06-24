import { serverRequest } from 'gpApi/server-request'
import { getServerToken, isTokenExpired } from 'helpers/tokenHelper'
import type { ExperimentVariants } from '@goodparty_org/contracts'
import { getFlagOverrides } from './flagOverrides'

// Server-side flag resolution for the current user. gp-api evaluates Amplitude
// Experiment server-to-server, so the result is correct on first paint and the
// browser never has to reach Amplitude (ad blockers / blocked networks can't
// affect gating). Returns null for anonymous requests or on failure, in which
// case every flag reads off — the client never falls back to Amplitude.
export async function getFlagVariants(): Promise<ExperimentVariants | null> {
  // E2E-only deterministic overrides (no-op outside PR previews / local dev),
  // resolved up front and honored even without a server token: preview test
  // users authenticate via a cookie that the Clerk server session can't read,
  // so the normal token-gated resolution below would return null for them.
  const overrides = await getFlagOverrides()

  // Mirror fetchUserCampaign: skip the call entirely for unauthenticated
  // requests so bots hammering the app don't generate authed-endpoint traffic.
  const token = await getServerToken()
  if (!token || isTokenExpired(token)) {
    return overrides ?? null
  }

  const result = await serverRequest(
    'GET /v1/experiment/variants',
    {},
    { ignoreResponseError: true },
  )

  const resolved: ExperimentVariants = result.ok ? result.data.variants : {}

  if (overrides) {
    return { ...resolved, ...overrides }
  }

  return result.ok ? resolved : null
}
