import { z } from 'zod'
import {
  DEFAULT_TEXT_REPLY_RATE,
  PANEL_ASSUMED_REPLY_RATE,
  sizePanelAsk,
} from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'

const sizePanelAskInput = z.object({
  canReach: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'Everyone the text can reach, panel members included, as ' +
        'count_contacts counted it with Has Cell Phone and ' +
        'notContactedRecently true.',
    ),
  panelCanAsk: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'The panel members who can be asked now, as count_contacts counted ' +
        'them with civicPanelMember true, Has Cell Phone and ' +
        'notContactedRecently true.',
    ),
})

// Pure arithmetic over sizePanelAsk, so the model never sizes the panel
// part, the fresh sample or the cost in its head. The district's answers
// needed is read once per turn and fixed into the tool.
export const sizePanelAskFor = (
  input: z.infer<typeof sizePanelAskInput>,
  answersNeeded: number,
) => {
  const freshCanReach = Math.max(0, input.canReach - input.panelCanAsk)
  const size = sizePanelAsk({
    answersNeeded,
    panelCanAsk: Math.min(input.panelCanAsk, input.canReach),
    freshCanReach,
  })
  if (size.freshSize === 0) {
    return {
      error:
        'Everyone this text can reach is already on the civic panel, so ' +
        'it would invite nobody new. Say so instead of proposing it.',
    }
  }
  const expected = size.expectedAnswers
  return {
    answersNeeded,
    expectedAnswers: Math.round(expected),
    reachesAnswersNeeded: expected >= answersNeeded,
    // Absent when nobody on the panel can be asked now: the card is the
    // fresh sample alone.
    panelSampleSize: size.panelSize > 0 ? size.panelSize : undefined,
    freshSampleSize: size.freshSize,
    sampleSize: size.sampleSize,
    targetResponses: Math.max(1, Math.min(answersNeeded, Math.floor(expected))),
    // The blend of the panel and cold rates across the whole send.
    assumedReplyRate: Number((expected / size.sampleSize).toFixed(4)),
    panelReplyRate: PANEL_ASSUMED_REPLY_RATE,
    freshReplyRate: DEFAULT_TEXT_REPLY_RATE,
    cost: calcTextAmountInCents(size.sampleSize) / 100,
  }
}

export const buildSizePanelAskTool = (
  answersNeeded: number,
): LlmStreamTool<typeof sizePanelAskInput> => ({
  description:
    'Size the one text a check sends first: the panel members who can be ' +
    'asked now plus a random group of residents not on the panel, enough ' +
    `for about ${answersNeeded} answers. Call it after both count_contacts ` +
    'counts. Returns panelSampleSize (absent when no member can be asked), ' +
    'sampleSize for the whole send, targetResponses, assumedReplyRate, the ' +
    'answers expected and the cost in dollars. Use these numbers as given; ' +
    'never work them out yourself.',
  inputSchema: sizePanelAskInput,
  execute: (input) => sizePanelAskFor(input, answersNeeded),
})
