import 'server-only'
import { Experiment } from '@amplitude/experiment-node-server'
import { cookies } from 'next/headers'
import { getFlagOverrides } from '@shared/experiments/flagOverrides'

// gp-marketing adds this to the "Claim this profile" link on unclaimed /people
// profiles. It only picks which panel the page shows; it grants nothing.
export const PROFILE_CLAIM_SIGNUP_SOURCE = 'profile_claim'
export const SIGNUP_PROFILE_CLAIM_FLAG_KEY = 'signup-profile-claim-variation'

// Segment writes this on the top-level domain (.goodparty.org), so a visitor
// arriving from the marketing site already carries it on their first request.
export const SEGMENT_ANONYMOUS_ID_COOKIE = 'ajs_anonymous_id'

// The page waits on this before first paint, so it is kept short: a slow or
// failed answer shows the original sign-up panel.
export const EVALUATION_TIMEOUT_MS = 1000

const ANONYMOUS_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

// Older analytics.js builds stored the id JSON-encoded ("%22uuid%22"); the
// current one stores it raw. Anything else is ignored rather than sent on.
export const parseSegmentAnonymousId = (
  raw: string | undefined,
): string | null => {
  if (!raw) return null
  let value = raw
  try {
    value = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    value = value.slice(1, -1)
  }
  return ANONYMOUS_ID_PATTERN.test(value) ? value : null
}

let client: ReturnType<typeof Experiment.initializeRemote> | null = null

const getClient = (deploymentKey: string) => {
  if (!client) {
    client = Experiment.initializeRemote(deploymentKey, {
      fetchTimeoutMillis: EVALUATION_TIMEOUT_MS,
      fetchRetries: 0,
    })
  }
  return client
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: Error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })

// Evaluated per request for this visitor's anonymous id, never cached: the
// sign-up page is dynamic (it reads the session and cookies), so one
// visitor's answer is never served to another.
export const isProfileClaimVariationOn = async (): Promise<boolean> => {
  // The same off-prod e2e override cookie the shared resolver honors, so a
  // Playwright test or a preview can force the panel without live targeting.
  const override = (await getFlagOverrides())?.[SIGNUP_PROFILE_CLAIM_FLAG_KEY]
  if (override) return override.value === 'on'

  const deploymentKey = process.env.AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY
  if (!deploymentKey) return false

  const cookieStore = await cookies()
  const deviceId = parseSegmentAnonymousId(
    cookieStore.get(SEGMENT_ANONYMOUS_ID_COOKIE)?.value,
  )
  if (!deviceId) return false

  try {
    const variants = await withTimeout(
      getClient(deploymentKey).fetchV2(
        { device_id: deviceId },
        { flagKeys: [SIGNUP_PROFILE_CLAIM_FLAG_KEY] },
      ),
      EVALUATION_TIMEOUT_MS,
    )
    return variants?.[SIGNUP_PROFILE_CLAIM_FLAG_KEY]?.value === 'on'
  } catch {
    return false
  }
}
