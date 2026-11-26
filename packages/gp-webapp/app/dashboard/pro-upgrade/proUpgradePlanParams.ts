// What the wizard's entry URL carries beyond attribution: which plan the
// candidate is buying and where the success step sends them back to. The
// wizard keeps these in state and re-appends them to every step URL, so a
// reload or a Stripe redirect return lands with the same choices.

export type ProUpgradePlan = 'pro' | 'team'

export interface ProUpgradeCarry {
  plan: ProUpgradePlan | null
  returnTo: string | null
  // The page the candidate pressed the CTA on, which Back off the first step
  // returns to. Separate from `returnTo`, which is where success goes.
  backTo: string | null
  // The candidate held Pro when they bought Team, so only the difference was
  // charged and nothing they already had is new.
  fromPro: boolean
}

export const EMPTY_PRO_UPGRADE_CARRY: ProUpgradeCarry = {
  plan: null,
  returnTo: null,
  backTo: null,
  fromPro: false,
}

export const TEAM_SETTINGS_PATH = '/dashboard/team'
export const PLANS_PATH = '/dashboard/plans'
// The param the plans page reads the page that opened it from.
export const PLANS_BACK_TO_PARAM = 'backTo'

// Exact paths only: `returnTo` is user-controlled, so anything that is not
// one of these dashboard pages is dropped rather than followed.
const RETURN_TO_ALLOWLIST: readonly string[] = [
  '/dashboard',
  TEAM_SETTINGS_PATH,
  '/dashboard/outreach',
  '/dashboard/contacts',
  '/dashboard/account',
  '/dashboard/race-opponent',
  PLANS_PATH,
]

const PARSE_ORIGIN = 'http://return-to.invalid'

const parsePath = (value: string | null | undefined): URL | null => {
  if (!value || !value.startsWith('/')) return null
  let url: URL
  try {
    url = new URL(value, PARSE_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== PARSE_ORIGIN) return null
  return RETURN_TO_ALLOWLIST.includes(url.pathname) ? url : null
}

// The page that opened the plans page, or null. Plans itself is not one:
// Back to the page you are on goes nowhere.
export const parsePlansBackTo = (
  value: string | null | undefined,
): string | null => {
  const url = parsePath(value)
  return url && url.pathname !== PLANS_PATH ? url.pathname : null
}

// The plans page's own URL, carrying where the candidate first came from so
// a round trip through checkout still ends there.
export const plansHrefWithBackTo = (backTo: string | null): string =>
  backTo
    ? `${PLANS_PATH}?${new URLSearchParams({ [PLANS_BACK_TO_PARAM]: backTo })}`
    : PLANS_PATH

// A page to send the candidate to. The plans page keeps its own `backTo` so
// Back from checkout to Plans, then Back again, reaches the original page.
export const parseReturnTo = (
  value: string | null | undefined,
): string | null => {
  const url = parsePath(value)
  if (!url) return null
  if (url.pathname !== PLANS_PATH) return url.pathname
  return plansHrefWithBackTo(
    parsePlansBackTo(url.searchParams.get(PLANS_BACK_TO_PARAM)),
  )
}

export const parseProUpgradeCarry = (
  params: Pick<URLSearchParams, 'get'> | null,
): ProUpgradeCarry => {
  const plan = params?.get('plan')
  return {
    plan: plan === 'pro' || plan === 'team' ? plan : null,
    returnTo: parseReturnTo(params?.get('returnTo')),
    backTo: parseReturnTo(params?.get('back')),
    fromPro: params?.get('from') === 'pro',
  }
}

export const carryQueryString = (carry: ProUpgradeCarry): string => {
  const params = new URLSearchParams()
  if (carry.plan) params.set('plan', carry.plan)
  if (carry.returnTo) params.set('returnTo', carry.returnTo)
  if (carry.backTo) params.set('back', carry.backTo)
  if (carry.fromPro) params.set('from', 'pro')
  const query = params.toString()
  return query ? `?${query}` : ''
}
