import { z } from 'zod'

// Both providers key questions, choice options and answers by this pattern.
export const DecisionKeySchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

const YesNoQuestionSchema = z.object({
  type: z.literal('yesNo'),
  instructions: z.string().min(1),
  trueDescription: z.string().min(1).optional(),
  falseDescription: z.string().min(1).optional(),
})

const ChoiceQuestionSchema = z.object({
  type: z.literal('choice'),
  instructions: z.string().min(1),
  options: z
    .record(DecisionKeySchema, z.string().min(1))
    .refine((options) => Object.keys(options).length >= 2, {
      message: 'A choice question needs at least two options',
    }),
})

// Index 0 is the lowest level.
const ScoreQuestionSchema = z.object({
  type: z.literal('score'),
  instructions: z.string().min(1),
  levels: z.array(z.string().min(1)).min(2),
})

export const DecisionQuestionSchema = z.discriminatedUnion('type', [
  YesNoQuestionSchema,
  ChoiceQuestionSchema,
  ScoreQuestionSchema,
])

export const DecisionQuestionsSchema = z
  .record(DecisionKeySchema, DecisionQuestionSchema)
  .refine((questions) => Object.keys(questions).length > 0, {
    message: 'Ask at least one question',
  })

export type YesNoQuestion = z.infer<typeof YesNoQuestionSchema>
export type ChoiceQuestion = z.infer<typeof ChoiceQuestionSchema>
export type ScoreQuestion = z.infer<typeof ScoreQuestionSchema>
export type DecisionQuestion = z.infer<typeof DecisionQuestionSchema>
export type DecisionQuestions = Record<string, DecisionQuestion>

export interface YesNoAnswer {
  type: 'yesNo'
  /** P(yes) >= 0.5. A caller with its own cut reads probabilities. */
  value: boolean
  probabilities: { true: number; false: number }
  confidence?: number
}

export interface ChoiceAnswer {
  type: 'choice'
  /** The chosen option id. */
  value: string
  probabilities: Record<string, number>
  confidence?: number
}

export interface ScoreAnswer {
  type: 'score'
  /** The provider's score on the question's levels, 0 being the lowest. */
  value: number
  probabilities: Record<string, number>
  confidence?: number
}

export type DecisionAnswer = YesNoAnswer | ChoiceAnswer | ScoreAnswer

export type AnswerFor<Q extends DecisionQuestion> = Q extends YesNoQuestion
  ? YesNoAnswer
  : Q extends ChoiceQuestion
    ? ChoiceAnswer
    : ScoreAnswer

export type DecisionAnswers<Q extends DecisionQuestions> = {
  [K in keyof Q]: AnswerFor<Q[K]>
}

export const DECISION_MODEL_PROVIDERS = ['gemini', 'typesafe'] as const
export type DecisionModelProviderName =
  (typeof DECISION_MODEL_PROVIDERS)[number]

export interface DecisionRequest<Q extends DecisionQuestions> {
  input: string
  questions: Q
}

export interface DecisionUsage {
  inputTokens: number
  outputTokens?: number
}

export interface DecisionResult<Q extends DecisionQuestions> {
  answers: DecisionAnswers<Q>
  usage: DecisionUsage
  model: string
  provider: DecisionModelProviderName
  /** Null when the model has no known price. */
  costUsd: number | null
}

/** What one provider call returns, before the service prices it. */
export interface ProviderDecision {
  answers: Record<string, DecisionAnswer>
  usage: DecisionUsage
  model: string
}
