import { useFlagOn } from './FeatureFlagsProvider'

export const CAMPAIGN_MANAGER_CHAT_HOME_FLAG_KEY = 'campaign-manager-chat-home'

interface UseCampaignManagerChatHomeFlagResult {
  ready: boolean
  enabled: boolean
}

// Gate for the conversation-first Campaign Manager home: on, `/dashboard`
// renders the manager as an open conversation instead of the card stack, and
// the footer chat dock is dropped on that route so there is only one chat on
// screen. Ships dark and is turned on per candidate.
//
// Pass trackExposure=false from a surface that reads the flag but isn't the
// treatment (e.g. a layout deciding whether to mount the dock), so the read
// doesn't inflate the exposed population.
export const useCampaignManagerChatHomeFlag = (
  trackExposure = true,
): UseCampaignManagerChatHomeFlagResult => {
  const { ready, on } = useFlagOn(CAMPAIGN_MANAGER_CHAT_HOME_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
