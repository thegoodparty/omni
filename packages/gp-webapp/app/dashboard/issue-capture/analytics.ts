import type { ConstituentFeedbackChannel } from '@goodparty_org/contracts'

// The capture events already report these channels as doorKnocking and
// phoneBanking, so the report's events use the same values: one channel is
// one value across every Issue Capture event.
export const ANALYTICS_CHANNEL: Record<ConstituentFeedbackChannel, string> = {
  door_knock: 'doorKnocking',
  phone_bank: 'phoneBanking',
}
