import { useFlagOn } from '@shared/experiments/FeatureFlagsProvider'
import type { ChatScope } from '../chatClient'

export const SERVE_CHAT_ATTACHMENTS_FLAG = 'serve-chat-attachments'

export const useAttachmentsEnabled = (
  scope: ChatScope,
): {
  ready: boolean
  enabled: boolean
} => {
  const { ready, on } = useFlagOn(SERVE_CHAT_ATTACHMENTS_FLAG, {
    trackExposure: false,
  })
  return { ready, enabled: on && scope === 'chief_of_staff' }
}
