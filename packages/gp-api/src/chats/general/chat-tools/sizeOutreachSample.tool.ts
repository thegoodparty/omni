import { z } from 'zod'
import {
  DEFAULT_TEXT_REPLY_RATE,
  recommendedSampleSize,
  SAMPLE_TARGET_REPLIES,
} from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'

const sizeOutreachSampleInput = z.object({
  audience: z
    .number()
    .int()
    .min(
      1,
      'That audience counted nobody, so there is no one to text. Change ' +
        'the filter and count again before you size a sample.',
    )
    .describe(
      'The whole audience, as count_contacts counted it, even when ' +
        'widening.',
    ),
  replyRate: z
    .number()
    .positive()
    .max(1)
    .optional()
    .describe(
      "This office's own text reply rate as a fraction (0.04 for 4%), " +
        'from read_past_outreach. Omit it when there is none.',
    ),
  repliesAlready: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'Replies already in from earlier sends to this audience, when ' +
        'widening a sample that came back thin.',
    ),
  alreadyAsked: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'When widening, how many people those earlier sends went to, from ' +
        'read_past_outreach. They are left out of the new sample, so ' +
        'audience stays the full count_contacts count.',
    ),
})

const dollars = (texts: number): number => calcTextAmountInCents(texts) / 100

// Pure arithmetic over the polls methodology, so the model never sizes a
// sample or prices a send in its head.
export const sizeOutreachSample = (
  input: z.infer<typeof sizeOutreachSampleInput>,
) => {
  const replyRate = input.replyRate ?? DEFAULT_TEXT_REPLY_RATE
  const notYetAsked = Math.max(0, input.audience - (input.alreadyAsked ?? 0))
  if (notYetAsked === 0) {
    return {
      error:
        'Everyone in this audience has already been asked, so a wider ' +
        'sample would reach nobody new. Say so instead of proposing one.',
    }
  }
  if ((input.repliesAlready ?? 0) >= SAMPLE_TARGET_REPLIES) {
    return {
      error:
        `The ${SAMPLE_TARGET_REPLIES} replies a sample is sized for are ` +
        'already in, so there is nothing to widen. Read what came back.',
    }
  }
  const sampleSize = recommendedSampleSize({
    audience: notYetAsked,
    replyRate,
    repliesAlready: input.repliesAlready,
  })
  return {
    targetReplies: SAMPLE_TARGET_REPLIES,
    replyRate,
    notYetAsked,
    sampleSize,
    wholeAudience: sampleSize >= notYetAsked,
    sampleCost: dollars(sampleSize),
    wholeAudienceCost: dollars(notYetAsked),
  }
}

export const buildSizeOutreachSampleTool = (): LlmStreamTool<
  typeof sizeOutreachSampleInput
> => ({
  description:
    'Size a random sample for a text send, the way polls are sized: ' +
    `enough people for about ${SAMPLE_TARGET_REPLIES} replies. Call it ` +
    'after count_contacts, before you present a text. Returns sampleSize, ' +
    'whether that is everyone not yet asked, and the cost in dollars of ' +
    'the sample and of texting all of them. Use these numbers as given; ' +
    'never work them out yourself.',
  inputSchema: sizeOutreachSampleInput,
  execute: sizeOutreachSample,
})
