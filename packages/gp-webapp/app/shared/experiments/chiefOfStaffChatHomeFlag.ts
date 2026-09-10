import { useFlagOn } from './FeatureFlagsProvider'

export const CHIEF_OF_STAFF_CHAT_HOME_FLAG_KEY = 'chief-of-staff-chat-home'

interface UseChiefOfStaffChatHomeFlagResult {
  ready: boolean
  enabled: boolean
}

// Gate for the conversation-first Chief of Staff home: on, /dashboard/
// chief-of-staff renders the agent as an open conversation instead of a stack
// of task cards behind a footer chat dock. Ships dark and is turned on per
// elected official.
//
// Pass trackExposure=false from a surface that reads the flag but isn't the
// treatment, so the read doesn't inflate the exposed population.
export const useChiefOfStaffChatHomeFlag = (
  trackExposure = true,
): UseChiefOfStaffChatHomeFlagResult => {
  const { ready, on } = useFlagOn(CHIEF_OF_STAFF_CHAT_HOME_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
