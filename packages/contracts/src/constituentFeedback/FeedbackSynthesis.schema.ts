import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import {
  ConstituentFeedbackChannelSchema,
  IssueTagSourceSchema,
  IssueTagStatusSchema,
  SynthesisRunStatusSchema,
} from '../generated/enums'
import {
  CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH,
  ConstituentFeedbackIssueSchema,
  IssueTagRefSchema,
} from './ConstituentFeedback.schema'

export const FEEDBACK_SYNTHESIS_SOURCE_TYPE = 'constituent_feedback'

// What a synthesis engine publishes when it has grouped a run's memos: the
// polls pipeline's `pollAnalysisComplete` shape, keyed by a source type and
// id instead of a poll id, with a memo id where polls carry a phone number.
// Snake case on `respondent_id` because that is the wire convention the
// pipeline already uses for `phone_number`.
//
// Members come from the S3 rows at `responsesLocation` when the engine wrote
// them, and otherwise from each issue's quotes and `memberIds`. The mock
// engine writes no rows, so it lists every member; the pipeline may do both.
export const FeedbackSynthesisCompleteEventSchema = z.object({
  type: z.literal('feedbackSynthesisComplete'),
  data: z.object({
    sourceType: z.literal(FEEDBACK_SYNTHESIS_SOURCE_TYPE),
    sourceId: z.string(),
    totalResponses: z.number(),
    responsesLocation: z.string().nullable(),
    issues: z.array(
      z.object({
        rank: z.number().int().min(1),
        theme: z.string(),
        summary: z.string(),
        analysis: z.string(),
        responseCount: z.number(),
        quotes: z.array(
          z.object({ quote: z.string(), respondent_id: z.string() }),
        ),
        memberIds: z.array(z.string()).optional(),
      }),
    ),
  }),
})
export type FeedbackSynthesisCompleteEvent = z.infer<
  typeof FeedbackSynthesisCompleteEventSchema
>

// One row per memo fragment in the pipeline's S3 output. A row whose theme
// matches no published issue (an unclustered fragment, or a cluster outside
// the top N) links to nothing.
export const FeedbackSynthesisResponseRowsSchema = z.array(
  z.object({ respondent_id: z.string(), theme: z.string() }),
)
export type FeedbackSynthesisResponseRows = z.infer<
  typeof FeedbackSynthesisResponseRowsSchema
>

export const SynthesisRunSchema = z.object({
  id: z.string(),
  status: SynthesisRunStatusSchema,
  createdAt: zCoerceDate(),
  completedAt: zCoerceDate().nullable(),
  engine: z.string(),
})
export type SynthesisRun = z.infer<typeof SynthesisRunSchema>

export const StanceCountsSchema = z.object({
  supports: z.number().int(),
  opposes: z.number().int(),
  mixed: z.number().int(),
  unclear: z.number().int(),
})
export type StanceCounts = z.infer<typeof StanceCountsSchema>

// Counts are computed when the report is read, over members whose memo is
// confirmed now, not when the run wrote them: a memo re-recorded after the
// run loses its confirmation and drops out of every count until it is
// confirmed again. A memo can sit in two themes, so a count reads
// "conversations that touched this theme".
//
// `conversationCount` counts memos. `stanceCounts` and `desiredOutcomes` are
// over those memos' issues, so a conversation that named two issues adds two
// stances and the four counts can sum past `conversationCount`.
export const FeedbackThemeSummarySchema = z.object({
  id: z.string(),
  rank: z.number().int(),
  title: z.string(),
  summary: z.string(),
  conversationCount: z.number().int(),
  stanceCounts: StanceCountsSchema,
  // Up to five distinct outcomes people asked for.
  desiredOutcomes: z.array(z.string()),
  tag: IssueTagRefSchema.nullable(),
})
export type FeedbackThemeSummary = z.infer<typeof FeedbackThemeSummarySchema>

// The report lists an effort's memos itself, for the states with no themes
// to show: under the floor, and while a run is in flight. Capped so a large
// effort cannot balloon the payload; the newest are the ones worth reading.
export const FEEDBACK_REPORT_MEMO_LIMIT = 200

export const FeedbackReportMemoSchema = z.object({
  id: z.string(),
  personId: z.string(),
  occurredAt: zCoerceDate(),
  channel: ConstituentFeedbackChannelSchema,
  // The canvasser's own summary, never the other person's words.
  transcript: z.string().nullable(),
  issues: z.array(ConstituentFeedbackIssueSchema),
  actorName: z.string().nullable(),
  // Null means waiting for review: listed, never counted.
  confirmedAt: zCoerceDate().nullable(),
})
export type FeedbackReportMemo = z.infer<typeof FeedbackReportMemoSchema>

export const FeedbackReportResponseSchema = z.object({
  // The effort's question, from its turf or list. Null when it asked none.
  question: z.string().nullable(),
  // A turf's envelope is door_knock, a phone list's is phone_bank, whether
  // or not any memo has been recorded on it yet.
  channel: ConstituentFeedbackChannelSchema,
  // The fewest confirmed memos a run accepts. Sent rather than known by the
  // client so the line under the floor cannot drift from the 422.
  floor: z.number().int(),
  denominators: z.object({
    // Distinct people who answered on this effort.
    conversations: z.number().int(),
    memos: z.number().int(),
    confirmed: z.number().int(),
    // Memos nobody has confirmed. Never in a theme or a count.
    pending: z.number().int(),
  }),
  // The latest run that has not been superseded: running, failed, or the
  // completed one the themes come from.
  run: SynthesisRunSchema.nullable(),
  // From the latest completed run, so a run in flight or a failed one
  // leaves the previous themes visible.
  themes: z.array(FeedbackThemeSummarySchema),
  // Confirmed and pending, newest first, at most FEEDBACK_REPORT_MEMO_LIMIT.
  memos: z.array(FeedbackReportMemoSchema).max(FEEDBACK_REPORT_MEMO_LIMIT),
})
export type FeedbackReportResponse = z.infer<
  typeof FeedbackReportResponseSchema
>

export const FeedbackThemeMemberSchema = z.object({
  feedbackId: z.string(),
  personId: z.string(),
  occurredAt: zCoerceDate(),
  channel: ConstituentFeedbackChannelSchema,
  // The canvasser's own summary, never the other person's words.
  transcript: z.string().nullable(),
  issues: z.array(ConstituentFeedbackIssueSchema),
  actorName: z.string().nullable(),
})
export type FeedbackThemeMember = z.infer<typeof FeedbackThemeMemberSchema>

export const FeedbackThemeDetailSchema = FeedbackThemeSummarySchema.extend({
  details: z.string(),
  // Every distinct outcome, not the report card's five.
  desiredOutcomes: z.array(z.string()),
  // Confirmed members only, newest first.
  members: z.array(FeedbackThemeMemberSchema),
})
export type FeedbackThemeDetail = z.infer<typeof FeedbackThemeDetailSchema>

export const IssueTagSchema = z.object({
  id: z.string(),
  name: z.string().max(CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH),
  status: IssueTagStatusSchema,
  source: IssueTagSourceSchema,
  declaredTopIssueId: z.number().int().nullable(),
  mergedIntoId: z.string().nullable(),
  proposedByRunId: z.string().nullable(),
  feedbackCount: z.number().int(),
})
export type IssueTag = z.infer<typeof IssueTagSchema>

export const IssueTagListResponseSchema = z.object({
  tags: z.array(IssueTagSchema),
})
export type IssueTagListResponse = z.infer<typeof IssueTagListResponseSchema>

// The curation actions. `normalizedName` is never sent: the server derives
// it, so two spellings of one name cannot become two tags.
export const UpdateIssueTagSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }).strict(),
  z
    .object({
      action: z.literal('rename'),
      name: z
        .string()
        .trim()
        .min(1)
        .max(CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH),
    })
    .strict(),
  // The target must be accepted, so merges never chain onto a suggestion.
  z.object({ action: z.literal('merge'), intoTagId: z.string() }).strict(),
  z.object({ action: z.literal('retire') }).strict(),
])
export type UpdateIssueTag = z.infer<typeof UpdateIssueTagSchema>

export const FEEDBACK_SEED_MAX_COUNT = 200

// Dev-only: fake confirmed memos on an effort, so the report can be
// exercised at realistic sizes without a canvass.
export const SeedFeedbackRequestSchema = z
  .object({
    outreachId: z.number().int().positive(),
    count: z.number().int().min(1).max(FEEDBACK_SEED_MAX_COUNT),
  })
  .strict()
export type SeedFeedbackRequest = z.infer<typeof SeedFeedbackRequestSchema>

export const SeedFeedbackResponseSchema = z.object({
  outreachId: z.number().int(),
  // Fewer than asked on a phone list, which holds one call per person.
  created: z.number().int(),
})
export type SeedFeedbackResponse = z.infer<typeof SeedFeedbackResponseSchema>
