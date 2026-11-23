import { z } from 'zod'

// ChatCaseSchema (src/chats/evals/judge/cases.ts) is the shape of a case in
// the lists the scout drafts into, but src/chats/evals/** is left out of the
// production build, so a job cannot import it. This mirrors its rules for the
// fields the scout writes, and draftedCase.schema.test.ts pins the bounds and
// the verdicts to the real schema so the two cannot drift.
export const CASE_ID_PATTERN = /^[A-Za-z0-9_-]+$/
export const MAX_CASE_ID_LENGTH = 80
export const MAX_CONDITION_CHARS = 2_000
export const MAX_HANDLED_WHEN_CHARS = 600
export const MAX_CASE_TURNS = 10

const trimmedWithin = (max: number) =>
  z.string().refine((value) => {
    const trimmed = value.trim()
    return trimmed.length >= 1 && trimmed.length <= max
  }, `must be 1 to ${max} characters once trimmed`)

export const DraftedCaseSchema = z
  .strictObject({
    caseId: z
      .string()
      .min(1)
      .max(MAX_CASE_ID_LENGTH)
      .regex(CASE_ID_PATTERN, 'caseId does not match the required pattern'),
    condition: trimmedWithin(MAX_CONDITION_CHARS),
    handledWhen: trimmedWithin(MAX_HANDLED_WHEN_CHARS),
    source: z.literal('production'),
    split: z.enum(['tune', 'holdout']),
    question: z.string().min(1).optional(),
    turns: z.array(z.string().min(1)).min(1).max(MAX_CASE_TURNS).optional(),
  })
  .refine(
    (draft) => (draft.question === undefined) !== (draft.turns === undefined),
    'exactly one of question or turns is required',
  )

export type DraftedCase = z.infer<typeof DraftedCaseSchema>
