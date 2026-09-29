import { AnalyticsBrowser, Analytics } from '@segment/analytics-next'
import cookie from 'js-cookie'
import { NEXT_PUBLIC_SEGMENT_WRITE_KEY } from 'appEnv'
import { ANONYMOUS_ID_COOKIE } from 'helpers/anonymousId'

// Rewritten to cdn.segment.com / api.segment.io in next.config.ts. Both of
// those hostnames are blocked outright by Brave and by ad blockers, and the
// failure is total rather than partial: the blocked settings fetch rejects
// `AnalyticsBrowser.load()` below, so every later call no-ops.
const PROXY_PREFIX = '/mx'

interface UserTraits {
  // Core user info
  email?: string
  firstName?: string
  lastName?: string
  name?: string
  phone?: string
  zip?: string
  // Candidate onboarding
  affiliation?: string
  pledgeCompleted?: boolean
  officeState?: string
  officeMunicipality?: string
  officeName?: string
  officeElectionDate?: string
  // Subscription & activation
  isProSubscriber?: boolean
  'Serve Activated'?: boolean
  // Voter outreach tracking
  voterContacts?: number
  // UTM parameters (e.g., utm_source, utm_medium, utm_campaign, etc.)
  // CLID parameters (e.g., gclid, fbclid, etc.)
  // Allow additional string properties for UTMs and CLIDs
  [key: string]: string | number | boolean | undefined
}

export const analytics: Promise<Analytics | null> =
  typeof window !== 'undefined' && NEXT_PUBLIC_SEGMENT_WRITE_KEY
    ? AnalyticsBrowser.load(
        {
          writeKey: NEXT_PUBLIC_SEGMENT_WRITE_KEY,
          cdnURL: `${window.location.origin}${PROXY_PREFIX}`,
        },
        {
          integrations: {
            'Segment.io': {
              apiHost: `${window.location.host}${PROXY_PREFIX}/evs`,
            },
          },
        },
      )
        .then((result) => (Array.isArray(result) ? result[0] : result))
        .then((instance) => {
          // Adopt the server-minted id before anything is sent, so the whole
          // session lands under one anonymous identity even after the browser
          // has expired Segment's own cookie. Chained into the load promise
          // rather than done by a caller: every consumer awaits this, so there
          // is no window in which an event could go out under the old id.
          const serverAnonymousId = cookie.get(ANONYMOUS_ID_COOKIE)
          if (
            serverAnonymousId &&
            instance.user().anonymousId() !== serverAnonymousId
          ) {
            instance.setAnonymousId(serverAnonymousId)
          }
          return instance
        })
        .catch((error) => {
          console.error('Segment analytics failed to load:', error)
          return null
        })
    : Promise.resolve(null)

export const getReadyAnalytics = async (): Promise<Analytics | null> => {
  if (typeof window === 'undefined') return null

  try {
    const analyticsInstance = await analytics
    if (!analyticsInstance) return null

    if (typeof analyticsInstance.ready === 'function') {
      await analyticsInstance.ready()
    }

    return analyticsInstance
  } catch (error) {
    console.error('Error getting ready analytics:', error)
    return null
  }
}

export const identifyUser = async (
  userId?: string | number | null,
  traits: UserTraits = {},
): Promise<boolean> => {
  try {
    const analyticsInstance = await getReadyAnalytics()
    if (
      !analyticsInstance ||
      typeof analyticsInstance.identify !== 'function'
    ) {
      return false
    }

    const hutk = cookie.get('hubspotutk')
    const enrichedTraits = hutk ? { ...traits, hutk } : traits

    if (userId) {
      analyticsInstance.identify(String(userId), enrichedTraits)
    } else {
      analyticsInstance.identify(enrichedTraits)
    }
    return true
  } catch (error) {
    console.error('Error identifying user:', error)
    return false
  }
}

interface PageProperties {
  [key: string]: string | number | boolean | undefined
}

export const trackPage = async (
  name?: string,
  properties: PageProperties = {},
): Promise<boolean> => {
  try {
    const analyticsInstance = await getReadyAnalytics()
    if (!analyticsInstance || typeof analyticsInstance.page !== 'function') {
      return false
    }

    analyticsInstance.page(name, properties)
    return true
  } catch (error) {
    console.error('Error tracking page:', error)
    return false
  }
}
