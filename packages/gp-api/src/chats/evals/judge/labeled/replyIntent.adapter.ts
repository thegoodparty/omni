import { DecisionModelError } from '@/decisionModels/decisionModel.error'
import type { DecisionUsage } from '@/decisionModels/schemas/decisionQuestions.schema'
import { DecisionModelService } from '@/decisionModels/services/decisionModel.service'
import {
  classifyReplyIntent,
  type ReplyIntentDecide,
} from '@/outreach/util/replyIntent.util'
import type { LabeledAdapter } from './types'

export const REPLY_INTENT_MODEL = 'regex'

// THE NAME THE REAL GEMINI KEY TRAVELS UNDER, for the reason modelKey.ts
// gives for Anthropic's: `.env.test` stubs GEMINI_API_KEY as `key`, and
// vitest applies it over the process environment, so a key exported under
// that name is replaced before the arm runs. It is handed to the decision
// client directly rather than installed under the stubbed name.
export const ARM_GEMINI_KEY_ENV = 'JUDGE_GEMINI_API_KEY'

const decisionModels = new DecisionModelService()

// One source of truth: the production classifier. A dry arm passes no
// client, which is exactly today's regex and makes no paid call. A spending
// arm runs the path REPLY_INTENT_DECISION_SHADOW turns on in ingest, on
// Gemini with the arm's own key. A missing or rejected key throws, which the
// runner records as an infraError; it never falls back to the regex, or the
// candidate would read SAME against a base it never measured.
export const replyIntentAdapter: LabeledAdapter = async (input, ctx) => {
  if (!ctx.spends) {
    return {
      labels: await classifyReplyIntent(input.text, null, input.channel),
      model: REPLY_INTENT_MODEL,
    }
  }

  const apiKey = process.env[ARM_GEMINI_KEY_ENV]
  if (!apiKey) {
    throw new Error(
      `This arm spends but ${ARM_GEMINI_KEY_ENV} is not set, so ` +
        'reply_intent cannot call the decision model. judge.yml passes it ' +
        'from the GEMINI_API_KEY repository secret; locally, export it in ' +
        'the shell you run the sweep from.',
    )
  }

  const call: { model?: string; usage?: DecisionUsage; costUsd?: number } = {}
  const decide: ReplyIntentDecide = async (request) => {
    const result = await decisionModels.decide(request, {
      provider: 'gemini',
      apiKey,
    })
    if (result.costUsd === null) {
      throw new Error(
        `${result.model} has no price in ` +
          'DECISION_MODEL_INPUT_USD_PER_MILLION_TOKENS, so this arm cannot ' +
          'record what it spent.',
      )
    }
    call.model = result.model
    call.usage = result.usage
    call.costUsd = result.costUsd
    return result
  }

  try {
    const labels = await classifyReplyIntent(input.text, decide, input.channel)
    return {
      labels,
      usage: {
        inputTokens: call.usage?.inputTokens ?? 0,
        costUsd: call.costUsd ?? 0,
      },
      model: call.model ?? REPLY_INTENT_MODEL,
    }
  } catch (err) {
    if (err instanceof DecisionModelError && err.reason === 'unauthorized') {
      throw new Error(
        `Gemini rejected the key in ${ARM_GEMINI_KEY_ENV}, so reply_intent ` +
          'cannot call the decision model.',
        { cause: err },
      )
    }
    throw err
  }
}
