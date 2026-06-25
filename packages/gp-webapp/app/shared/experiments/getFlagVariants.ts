import { serverRequest } from 'gpApi/server-request'
import { getServerToken, isTokenExpired } from 'helpers/tokenHelper'
import type { ExperimentVariants } from '@goodparty_org/contracts'

// Server-side flag resolution for the current user. gp-api evaluates Amplitude
// Experiment server-to-server, so the result is correct on first paint and the
// browser never has to reach Amplitude (ad blockers / blocked networks can't
// affect gating). Returns null for anonymous requests or on failure, in which
// case every flag reads off — the client never falls back to Amplitude.
export async function getFlagVariants(): Promise<ExperimentVariants | null> {
  // Mirror fetchUserCampaign: skip the call entirely for unauthenticated
  // requests so bots hammering the app don't generate authed-endpoint traffic.
  const token = await getServerToken()
  if (!token || isTokenExpired(token)) {
    return null
  }

  const result = await serverRequest(
    'GET /v1/experiment/variants',
    {},
    { ignoreResponseError: true },
  )

  if (!result.ok) {
    return null
  }
  return result.data.variants
}
