import { z } from 'zod'

// The question and answer map both providers speak: Gemini's
// /v1beta/decisions and TypeSafe's /v1/systemone. Yes/no is "noul" on the
// wire, and its answer is P(yes).

export type WireQuestion =
  | {
      type: 'noul'
      instructions: string
      criteria?: { true_description?: string; false_description?: string }
    }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }

const probability = z.number().min(0).max(1)

const WireNoulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: probability,
  confidence: probability.optional(),
})

const WireChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), probability),
  confidence: probability.optional(),
})

const WireScoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number(),
  probabilities: z.record(z.string(), probability),
  confidence: probability.optional(),
})

export const WireAnswerSchema = z.discriminatedUnion('type', [
  WireNoulAnswerSchema,
  WireChoiceAnswerSchema,
  WireScoreAnswerSchema,
])

export type WireAnswer = z.infer<typeof WireAnswerSchema>

// A blocked prompt can come back as a 200 with empty answers and the reason
// here, so neither answers nor usage is guaranteed.
export const GeminiDecisionsResponseSchema = z.object({
  answers: z.record(z.string(), WireAnswerSchema).default({}),
  usage: z
    .object({ total_input_tokens: z.number().int().nonnegative() })
    .optional(),
  prompt_feedback: z.object({ block_reason: z.string().optional() }).optional(),
})

// Google puts the machine-readable cause in an ErrorInfo detail's reason
// (API_KEY_INVALID arrives as a 400 INVALID_ARGUMENT, like a bad input).
export const GEMINI_API_KEY_INVALID_REASON = 'API_KEY_INVALID'

export const GeminiErrorResponseSchema = z.object({
  error: z.object({
    code: z.number().int().optional(),
    status: z.string().optional(),
    details: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
})

export const TypesafeSystemOneResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), WireAnswerSchema),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
})
