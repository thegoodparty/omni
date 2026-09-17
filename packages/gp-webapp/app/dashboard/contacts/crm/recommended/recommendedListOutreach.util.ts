import type { RecommendedList } from '@goodparty_org/contracts'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

export type RecommendedSendOutreachSurface =
  | 'recommendedCard'
  | 'recommendedDetail'

// Send outreach on a recommendation opens the channel picker; nothing is
// saved here. The event names the variant, and the saved list when the
// recommendation already matches one, so the funnel entry can be joined to
// what the flow later creates or selects.
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
