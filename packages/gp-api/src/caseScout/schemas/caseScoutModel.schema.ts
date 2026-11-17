import { z } from 'zod'
import {
  ANSWERED_VALUES,
  CONFIDENCE_VALUES,
  FAILURES,
  KNOWN_PATTERNS,
  RATING_VALUES,
  SEVERITY_VALUES,
  USE_CASES,
  YES_NO_VALUES,
} from '../caseScout.prompts'
import {
  CASE_ID_PATTERN,
  MAX_CASE_ID_LENGTH,
  MAX_CASE_TURNS,
  MAX_CONDITION_CHARS,
  MAX_HANDLED_WHEN_CHARS,
} from './draftedCase.schema'

// The scoring reply's shape, sent to the API as the structured output format
// (Python's SCORE_SCHEMA). As plain text Opus dropped a quote often enough to
// lose a third of scoring calls. No length limits: the API refuses them, so
// the summary and reason are clamped after parsing instead.
export const ScoreResponseSchema = z.strictObject({
  session_id: z.string(),
  requests: z.array(
    z.strictObject({
      request_ordinal: z.int(),
      primary_use_case: z.enum(USE_CASES),
      answered_request: z.enum(ANSWERED_VALUES),
      overall_rating: z.enum(RATING_VALUES),
      major_failure_type: z.enum(FAILURES),
      known_pattern: z.enum(KNOWN_PATTERNS),
      severity: z.literal(SEVERITY_VALUES),
      confidence: z.enum(CONFIDENCE_VALUES),
      human_review_needed: z.enum(YES_NO_VALUES),
      worth_quoting_anonymized: z.enum(YES_NO_VALUES),
      summary_nonidentifying: z.string(),
      reason_nonidentifying: z.string(),
    }),
  ),
})
export type ScoreResponse = z.infer<typeof ScoreResponseSchema>

export const MAX_SUMMARY_LENGTH = 220
export const MAX_REASON_LENGTH = 320
export const MAX_FAILURE_SUMMARY_LENGTH = 300

// The drafting reply is free text read with extractJson, as the Python reader
// reads it; these hold it to the bounds drafting.py's parser enforced.
const nonBlankWithin = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, 'must not be blank')

const QuestionCaseSchema = z.object({
  caseId: nonBlankWithin(MAX_CASE_ID_LENGTH).regex(CASE_ID_PATTERN),
  question: z.string().refine((value) => value.trim().length > 0),
  turns: z.undefined().optional(),
  condition: nonBlankWithin(MAX_CONDITION_CHARS),
  handledWhen: nonBlankWithin(MAX_HANDLED_WHEN_CHARS),
})

const TurnsCaseSchema = z.object({
  caseId: nonBlankWithin(MAX_CASE_ID_LENGTH).regex(CASE_ID_PATTERN),
  question: z.undefined().optional(),
  turns: z
    .array(z.string().refine((value) => value.trim().length > 0))
    .min(1)
    .max(MAX_CASE_TURNS),
  condition: nonBlankWithin(MAX_CONDITION_CHARS),
  handledWhen: nonBlankWithin(MAX_HANDLED_WHEN_CHARS),
})

const FailureSummarySchema = nonBlankWithin(MAX_FAILURE_SUMMARY_LENGTH)

export const DraftResponseSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('newCase'),
    failureSummary: FailureSummarySchema,
    case: z.union([QuestionCaseSchema, TurnsCaseSchema]),
  }),
  z.object({
    outcome: z.literal('coveredBy'),
    failureSummary: FailureSummarySchema,
    caseId: nonBlankWithin(MAX_CASE_ID_LENGTH),
  }),
  z.object({
    outcome: z.literal('needsSetup'),
    failureSummary: FailureSummarySchema,
    what: nonBlankWithin(MAX_FAILURE_SUMMARY_LENGTH),
  }),
])
export type DraftResponse = z.infer<typeof DraftResponseSchema>

export const SecondReadResponseSchema = z.array(z.json())
