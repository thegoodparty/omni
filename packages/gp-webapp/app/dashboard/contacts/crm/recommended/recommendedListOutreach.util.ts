import type { RecommendedList } from '@goodparty_org/contracts'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

export type RecommendedSendOutreachSurface =
  | 'recommendedCard'
  | 'recommendedDetail'

// Nothing is saved on the way to the hub. A recommendation that already
// matches one of the candidate's lists travels as that list's id, the same
// `?listId=` the saved-list cards use; one that does not travels as its
// variant, and the flow the candidate picks saves it on its audience step.
export const recommendedListOutreachHref = (
  recommendation: RecommendedList,
): string =>
  recommendation.existingFilterId !== null
    ? `/dashboard/outreach?listId=${recommendation.existingFilterId}`
    : `/dashboard/outreach?recommended=${recommendation.variant}`

export const trackRecommendedSendOutreach = (
  recommendation: RecommendedList,
  surface: RecommendedSendOutreachSurface,
): void => {
  trackEvent(EVENTS.VoterData.SendOutreachClicked, {
    surface,
    variant: recommendation.variant,
    ...(recommendation.existingFilterId !== null
      ? { listId: recommendation.existingFilterId }
      : {}),
  })
}
