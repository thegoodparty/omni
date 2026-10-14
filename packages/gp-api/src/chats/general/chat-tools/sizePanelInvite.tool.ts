import { z } from 'zod'
import {
  PANEL_SEED_ASSUMED_JOIN_RATE,
  PANEL_SEED_SAMPLE_SIZE,
  PANEL_SEED_TARGET_MEMBERS,
} from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'

const sizePanelInviteInput = z.object({
  audience: z
    .number()
    .int()
    .min(
      1,
      'Nobody in the district has a cell phone on file, so there is no one ' +
        'to invite. Say so instead of proposing the invite.',
    )
    .describe(
      'Everyone in the district with a cell phone, as count_contacts ' +
        'counted it with { hasCellPhone: true }.',
    ),
})

// To the cent under $10, so a tiny district's paid text never reads as $0.
const formatCost = (cents: number): string =>
  cents < 1000
    ? `$${(cents / 100).toFixed(2)}`
    : `$${Math.round(cents / 100).toLocaleString('en-US')}`

// Pure arithmetic over the panel's seed constants, so the model never sizes
// the invite or prices it in its head.
export const sizePanelInvite = (
  input: z.infer<typeof sizePanelInviteInput>,
) => {
  const sendTo = Math.min(PANEL_SEED_SAMPLE_SIZE, input.audience)
  return {
    targetMembers: PANEL_SEED_TARGET_MEMBERS,
    joinPerHundred: Math.round(PANEL_SEED_ASSUMED_JOIN_RATE * 100),
    sendTo,
    wholeAudience: sendTo >= input.audience,
    cost: formatCost(calcTextAmountInCents(sendTo)),
  }
}

export const buildSizePanelInviteTool = (): LlmStreamTool<
  typeof sizePanelInviteInput
> => ({
  description:
    'Size the text that builds the civic panel. Call it after ' +
    'count_contacts counts the district with a cell phone. Returns the ' +
    'members it aims for, how many in 100 are expected to reply JOIN, how ' +
    'many residents to text (sendTo), whether that is all of them, and ' +
    'the cost, ready to quote as written. Use these numbers as given; never work ' +
    'them out yourself.',
  inputSchema: sizePanelInviteInput,
  execute: sizePanelInvite,
})
