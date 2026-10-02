import { useFlagOn } from '@shared/experiments/FeatureFlagsProvider'
import type { ChatScope } from '../chatClient'

export const SERVE_CHAT_ATTACHMENTS_FLAG = 'serve-chat-attachments'
export const WIN_CHAT_ATTACHMENTS_FLAG = 'win-chat-attachments'

export const useAttachmentsEnabled = (
  scope: ChatScope,
): {
  ready: boolean
  enabled: boolean
} => {
  // Both flags are read on every call (hooks can't be conditional), but
  // exposure is tracked only for the flag that belongs to the passed scope —
  // otherwise a Serve surface would log a win-chat-attachments exposure (and
  // a Win surface a serve-chat-attachments one) for a flag it never acts on.
  const serve = useFlagOn(SERVE_CHAT_ATTACHMENTS_FLAG, {
    trackExposure: scope === 'chief_of_staff',
  })
  const win = useFlagOn(WIN_CHAT_ATTACHMENTS_FLAG, {
    trackExposure: scope === 'campaign_assistant',
  })

  if (scope === 'chief_of_staff')
    return { ready: serve.ready, enabled: serve.on }
  if (scope === 'campaign_assistant')
    return { ready: win.ready, enabled: win.on }
  return { ready: true, enabled: false }
}
