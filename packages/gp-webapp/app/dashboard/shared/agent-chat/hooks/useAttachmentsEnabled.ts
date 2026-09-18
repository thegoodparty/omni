import { useFlagOn } from '@shared/experiments/FeatureFlagsProvider'

export const SERVE_CHAT_ATTACHMENTS_FLAG = 'serve-chat-attachments'

// Returns false for all scopes until Story 7 wires the chief_of_staff gate.
export const useAttachmentsEnabled = (): {
  ready: boolean
  enabled: boolean
} => {
  const { ready } = useFlagOn(SERVE_CHAT_ATTACHMENTS_FLAG, {
    trackExposure: false,
  })
  return { ready, enabled: false }
}
