import { z } from 'zod'
import {
  OrdinanceStatusSchema,
  OrdinanceSeedTypeSchema,
} from '../generated/enums'

// A cited source. Shared across the step artifacts and the draft. Candidate for
// a normalized Source registry later (TDD Q12); JSON for now.
export const OrdinanceSourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url().optional(),
  publisher: z.string().optional(),
  kind: z.enum(['external', 'internal']).optional(),
  excerpt: z.string().optional(),
})
export type OrdinanceSource = z.infer<typeof OrdinanceSourceSchema>

// Snapshot of the pasted ordinance, captured at intake.
export const OrdinanceExistingLawSchema = z.object({
  sourceUrl: z.string().url(),
  chapterLabel: z.string().optional(),
  text: z.string(),
  fetchedAt: z.string(),
})
export type OrdinanceExistingLaw = z.infer<typeof OrdinanceExistingLawSchema>

// Step artifacts below are written by later slices (3-6); their shapes live here
// so the record response is fully typed. They are null until those slices run.
export const OrdinanceClarifySchema = z.object({ synthesis: z.string() })
export type OrdinanceClarify = z.infer<typeof OrdinanceClarifySchema>

export const OrdinanceClarifyAnswerSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  answer: z.string(),
  source: OrdinanceSourceSchema.optional(),
})
export type OrdinanceClarifyAnswer = z.infer<
  typeof OrdinanceClarifyAnswerSchema
>
export const OrdinanceClarifyAnswersSchema = z.array(
  OrdinanceClarifyAnswerSchema,
)

// Request body for persisting one clarify answer straight from the UI. The
// client is the source of truth for the answer (keyed by the widget's own
// questionId), so persistence no longer depends on the agent transcribing it.
export const SaveOrdinanceClarifyAnswerRequestSchema =
  OrdinanceClarifyAnswerSchema
export type SaveOrdinanceClarifyAnswerRequest = z.infer<
  typeof SaveOrdinanceClarifyAnswerRequestSchema
>

// One suggested answer to a clarify question. A factual option cites a source;
// a pure-judgment option may omit one. The UI always adds an "Or write your
// own..." freeform option on top of these.
export const OrdinanceClarifyOptionSchema = z.object({
  label: z.string(),
  rationale: z.string().optional(),
  source: OrdinanceSourceSchema.optional(),
})
export type OrdinanceClarifyOption = z.infer<
  typeof OrdinanceClarifyOptionSchema
>

// The ask_clarify_question tool payload: one question shown as a widget in the
// chat transcript. Persisted as the tool segment's payload so it replays on
// reload.
export const OrdinanceClarifyQuestionSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  options: z.array(OrdinanceClarifyOptionSchema),
})
export type OrdinanceClarifyQuestion = z.infer<
  typeof OrdinanceClarifyQuestionSchema
>

// The offer_next_step tool payload: when the agent has finished a step it calls
// this to render a "continue" button in the transcript. `label` is the button
// text; the destination step is derived client-side from the flow order.
export const OrdinanceNextStepOfferSchema = z.object({
  label: z.string().optional(),
})
export type OrdinanceNextStepOffer = z.infer<
  typeof OrdinanceNextStepOfferSchema
>

export const OrdinanceAuthoritySchema = z.object({
  status: z.enum(['pass', 'flag', 'attention']),
  explanation: z.string(),
  source: OrdinanceSourceSchema,
})

export const OrdinanceComparableSchema = z.object({
  city: z.string(),
  state: z.string(),
  population: z.number().int().optional(),
  govType: z.string().optional(),
  year: z.number().int().optional(),
  headline: z.string().optional(),
  quote: z.string(),
  outcome: z.string().optional(),
  status: z.enum(['passed', 'repealed', 'unknown']),
  failureReason: z.string().optional(),
  source: OrdinanceSourceSchema,
})
export const OrdinanceComparablesSchema = z.array(OrdinanceComparableSchema)

// --- Step-widget tool payloads ---------------------------------------------
// Args for the present_* tools the ordinance-flow agent calls to render a
// step's finding as a structured widget in the chat transcript. Persisted as
// the tool segment's payload (same replay mechanics as ask_clarify_question).
// Each payload is self-contained: the widget renders from it alone.

// present_authority_finding: the authority artifact plus the presentation
// fields the verdict card renders. `headline` is the card's verdict line;
// `explanation` (inherited) is the detail paragraph citing the statute;
// `confirmation` is the "what this means for you" close, when the agent has
// one.
export const OrdinanceAuthorityFindingSchema = OrdinanceAuthoritySchema.extend({
  headline: z.string(),
  confirmation: z.string().optional(),
})
export type OrdinanceAuthorityFinding = z.infer<
  typeof OrdinanceAuthorityFindingSchema
>

export const OrdinanceLawPointSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
})
export type OrdinanceLawPoint = z.infer<typeof OrdinanceLawPointSchema>

// present_current_law_summary: what the law on the books does today (`does`)
// and where it falls short for the user's goal (`gaps`).
export const OrdinanceCurrentLawSummarySchema = z.object({
  chapterLabel: z.string(),
  source: OrdinanceSourceSchema.optional(),
  does: z.array(OrdinanceLawPointSchema),
  gaps: z.array(OrdinanceLawPointSchema),
})
export type OrdinanceCurrentLawSummary = z.infer<
  typeof OrdinanceCurrentLawSummarySchema
>

export const OrdinanceHistoryEntrySchema = z.object({
  year: z.number().int(),
  label: z.string(),
  summary: z.string(),
  minutesExcerpt: z.string().optional(),
  speaker: z.string().optional(),
  source: OrdinanceSourceSchema.optional(),
})
export type OrdinanceHistoryEntry = z.infer<typeof OrdinanceHistoryEntrySchema>

// present_legislative_history: why the current chapter reads the way it does —
// a timeline of adoptions/amendments with council-minutes excerpts when found.
export const OrdinanceLegislativeHistorySchema = z.object({
  chapterLabel: z.string().optional(),
  entries: z.array(OrdinanceHistoryEntrySchema),
})
export type OrdinanceLegislativeHistory = z.infer<
  typeof OrdinanceLegislativeHistorySchema
>

// present_comparables: the comparables artifact plus the framing prose. Intro
// and takeaway live in the payload (not as separate assistant text) so the
// cards and their framing always render as one atomic block in stream order.
export const OrdinancePresentComparablesSchema = z.object({
  intro: z.string().optional(),
  comparables: OrdinanceComparablesSchema,
  takeaway: z.string().optional(),
})
export type OrdinancePresentComparables = z.infer<
  typeof OrdinancePresentComparablesSchema
>

export const OrdinanceQualityCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['pass', 'flag', 'attention']),
  note: z.string(),
  source: OrdinanceSourceSchema.optional(),
})
export const OrdinanceQualityReportSchema = z.object({
  checks: z.array(OrdinanceQualityCheckSchema),
  tally: z.object({
    pass: z.number().int(),
    flag: z.number().int(),
    attention: z.number().int(),
  }),
  stale: z.boolean(),
  ranAgainstBodyHash: z.string(),
})

export const OrdinanceResearchChapterSchema = z.object({
  label: z.string(),
  text: z.string(),
  citation: z.string().optional(),
})
export const OrdinanceResearchSchema = z
  .object({
    currentCode: z.object({
      chapters: z.array(OrdinanceResearchChapterSchema),
      loadedAt: z.string().optional(),
    }),
    historical: z.array(OrdinanceSourceSchema.extend({ summary: z.string() })),
    authority: z.array(OrdinanceSourceSchema),
    web: z.array(OrdinanceSourceSchema.extend({ snippet: z.string() })),
  })
  .partial()
export type OrdinanceResearch = z.infer<typeof OrdinanceResearchSchema>

export const OrdinanceScratchpadNoteSchema = z.object({
  step: z.string(),
  text: z.string(),
  createdAt: z.string(),
})
export const OrdinanceScratchpadSchema = z.array(OrdinanceScratchpadNoteSchema)

// Steps of the guided flow. Each (ordinance, step) gets its own chat
// conversation (the ordinance_flow scope). Not a Prisma enum: the persisted
// lastViewedStep column is a free String, and the anchor carries this value
// only to key the conversation, so a hand-written enum here is fine.
export const ORDINANCE_FLOW_STEP_VALUES = [
  'intro',
  'clarify',
  'authority',
  'current_law',
  'comparables',
  'draft',
] as const
export const OrdinanceFlowStepSchema = z.enum(ORDINANCE_FLOW_STEP_VALUES)
export type OrdinanceFlowStep = z.infer<typeof OrdinanceFlowStepSchema>

// Artifact types reused by the ordinance_flow chat context/prompt. The schemas
// above stay the source of truth; these just name their inferred types.
export type OrdinanceClarifyAnswers = z.infer<
  typeof OrdinanceClarifyAnswersSchema
>
export type OrdinanceAuthority = z.infer<typeof OrdinanceAuthoritySchema>
export type OrdinanceComparables = z.infer<typeof OrdinanceComparablesSchema>
export type OrdinanceScratchpad = z.infer<typeof OrdinanceScratchpadSchema>

export const OrdinanceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  electedOfficeId: z.string(),
  status: OrdinanceStatusSchema,
  seedType: OrdinanceSeedTypeSchema,
  issueSlug: z.string().nullable(),
  sourceLink: z.string().nullable(),
  goalText: z.string().nullable(),
  existingLaw: OrdinanceExistingLawSchema.nullable(),
  clarify: OrdinanceClarifySchema.nullable(),
  clarifyAnswers: OrdinanceClarifyAnswersSchema.nullable(),
  authority: OrdinanceAuthoritySchema.nullable(),
  comparables: OrdinanceComparablesSchema.nullable(),
  draftTitle: z.string().nullable(),
  draftBody: z.string().nullable(),
  draftSources: z.array(OrdinanceSourceSchema).nullable(),
  qualityReport: OrdinanceQualityReportSchema.nullable(),
  research: OrdinanceResearchSchema.nullable(),
  scratchpad: OrdinanceScratchpadSchema.nullable(),
  lastViewedStep: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Ordinance = z.infer<typeof OrdinanceSchema>

export const OrdinanceSummarySchema = OrdinanceSchema.pick({
  id: true,
  slug: true,
  status: true,
  seedType: true,
  draftTitle: true,
  lastViewedStep: true,
  createdAt: true,
  updatedAt: true,
})
export type OrdinanceSummary = z.infer<typeof OrdinanceSummarySchema>

export const OrdinanceStatusCountsSchema = z.record(
  OrdinanceStatusSchema,
  z.number().int(),
)
export type OrdinanceStatusCounts = z.infer<typeof OrdinanceStatusCountsSchema>

export const OrdinanceListResponseSchema = z.object({
  items: z.array(OrdinanceSummarySchema),
  counts: OrdinanceStatusCountsSchema,
})
export type OrdinanceListResponse = z.infer<typeof OrdinanceListResponseSchema>

export const CreateOrdinanceRequestSchema = z
  .object({
    seedType: OrdinanceSeedTypeSchema,
    issueSlug: z.string().optional(),
    sourceLink: z.string().url().optional(),
    goalText: z.string().optional(),
  })
  .refine((v) => v.seedType !== 'issue' || Boolean(v.issueSlug), {
    message: 'issueSlug is required when seedType is "issue"',
    path: ['issueSlug'],
  })
export type CreateOrdinanceRequest = z.infer<
  typeof CreateOrdinanceRequestSchema
>

export const UpdateOrdinanceRequestSchema = z
  .object({
    status: OrdinanceStatusSchema,
    draftBody: z.string(),
    lastViewedStep: z.string(),
  })
  .partial()
export type UpdateOrdinanceRequest = z.infer<
  typeof UpdateOrdinanceRequestSchema
>
