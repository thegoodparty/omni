import { isCivicPanelJoinMessage } from '@/outreach/util/civicPanelJoin.util'
import { isCivicPanelLeaveMessage } from '@/outreach/util/civicPanelLeave.util'
import { isOptOutMessage } from '@/outreach/util/textOptOut.util'
import type { LabeledAdapter } from './types'

export const REPLY_INTENT_MODEL = 'regex'

// Calls the production predicates directly, so a branch that edits one of
// them is what the candidate arm measures. Hard labels: a regex has no
// probabilities to give.
export const replyIntentAdapter: LabeledAdapter = async (input) => ({
  labels: {
    optOut: { value: isOptOutMessage(input.text) },
    civicPanelJoin: { value: isCivicPanelJoinMessage(input.text) },
    civicPanelLeave: { value: isCivicPanelLeaveMessage(input.text) },
  },
  model: REPLY_INTENT_MODEL,
})
