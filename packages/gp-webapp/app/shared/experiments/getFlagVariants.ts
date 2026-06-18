import { serverRequest } from 'gpApi/server-request'
import { getServerToken, isTokenExpired } from 'helpers/tokenHelper'
import type { ExperimentVariantsResponse } from '@goodparty_org/contracts'

export type FlagVariants = ExperimentVariantsResponse['variants']

// Server-side flag resolution for the current user. gp-api evaluates Amplitude
// Experiment server-to-server, so the result is correct on first paint and
// never depends on the browser reaching Amplitude. Returns null for anonymous
// requests or on any failure, in which case the client SDK fetch takes over.
export async function getFlagVariants(): Promise<FlagVariants | null> {
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
