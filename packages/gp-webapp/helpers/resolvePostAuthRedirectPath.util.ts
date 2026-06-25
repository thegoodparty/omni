export interface CampaignStatus {
  status: string | boolean
  slug?: string
  step?: number
}

/** Entry point for the elected-official "serve" onboarding flow. */
export const SERVE_ONBOARDING_PATH = '/serve/onboarding'
/** Public magic-link redemption landing page (ticket sign-in). */
export const SERVE_WELCOME_PATH = '/serve/welcome'

/**
 * Entry point for the candidate ("win") onboarding flow. A lead with no
 * campaign and no elected office resolves here, where they pick their office
 * and their Campaign is created.
 */
export const WIN_ONBOARDING_PATH = '/onboarding/office-selection'
/** Public candidate magic-link redemption landing page (ticket sign-in). */
export const WIN_WELCOME_PATH = '/win/welcome'

export const resolvePostAuthRedirectPath = (
  user: { roles?: string[] } | null,
  campaignStatus: CampaignStatus | null,
  hasElectedOffice = false,
  // Defaults to true so existing callers (and the win→serve dashboard path)
  // keep landing on /dashboard. Only an elected official whose serve onboarding
  // hasn't completed is routed into the EO onboarding flow.
  electedOfficeOnboardingComplete = true,
): string => {
  if (user?.roles?.includes('sales')) {
    return '/sales/add-campaign'
  }
  if (campaignStatus?.status === 'candidate') {
    return '/dashboard'
  }
  if (campaignStatus?.status === 'onboarding' && campaignStatus?.slug) {
    return `/onboarding/${campaignStatus.slug}/${campaignStatus.step ?? 1}`
  }
  if (!campaignStatus || campaignStatus.status === false) {
    if (hasElectedOffice) {
      return electedOfficeOnboardingComplete
        ? '/dashboard'
        : SERVE_ONBOARDING_PATH
    }
    return '/onboarding/office-selection'
  }
  return '/dashboard/profile'
}
