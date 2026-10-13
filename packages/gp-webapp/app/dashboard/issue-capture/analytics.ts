import type { FeedbackReportChannel } from '@goodparty_org/contracts'

// The capture events already report these channels as doorKnocking and
// phoneBanking, so the report's events use the same values: one channel is
// one value across every Issue Capture event. A text send reports under the
// outreach events' own name for it.
export const ANALYTICS_CHANNEL: Record<FeedbackReportChannel, string> = {
  door_knock: 'doorKnocking',
  phone_bank: 'phoneBanking',
  text: 'sms',
}
