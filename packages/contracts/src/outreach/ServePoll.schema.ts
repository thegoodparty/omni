import { z } from 'zod'

// Serve self-serve polls: an Outreach row of type `poll` plus an OutreachPoll
// satellite. The question lives in the spine's `message`.

// Product must confirm this list. Ids are stored on OutreachPoll.topic, so
// renaming one later needs a data fix.
export const POLL_TOPICS = [
  { id: 'roads_infrastructure', label: 'Roads and infrastructure' },
  { id: 'public_safety', label: 'Public safety' },
  { id: 'parks_recreation', label: 'Parks and recreation' },
  { id: 'housing', label: 'Housing' },
  { id: 'budget_taxes', label: 'Local budget and taxes' },
  { id: 'schools', label: 'Schools' },
  { id: 'economic_development', label: 'Economic development' },
  { id: 'custom', label: 'Write my own' },
] as const
export const POLL_TOPIC_IDS = POLL_TOPICS.map((topic) => topic.id) as [
  (typeof POLL_TOPICS)[number]['id'],
  ...(typeof POLL_TOPICS)[number]['id'][],
]
export const PollTopicSchema = z.enum(POLL_TOPIC_IDS)
export type PollTopic = z.infer<typeof PollTopicSchema>

export const POLL_TONE_VALUES = [
  'Neutral',
  'Warm',
  'Direct',
  'Friendly',
] as const
export const PollToneSchema = z.enum(POLL_TONE_VALUES)
export type PollTone = z.infer<typeof PollToneSchema>

export const POLL_QUESTION_MIN_LENGTH = 10
export const POLL_QUESTION_MAX_LENGTH = 480

const PollQuestionSchema = z
  .string()
  .min(POLL_QUESTION_MIN_LENGTH)
  .max(POLL_QUESTION_MAX_LENGTH)

export const ServePollDraftRequestSchema = z.object({
  topic: PollTopicSchema,
  tone: PollToneSchema,
  currentDraft: PollQuestionSchema.optional(),
})
export type ServePollDraftRequest = z.infer<typeof ServePollDraftRequestSchema>

export const ServePollDraftResponseSchema = z.object({
  question: PollQuestionSchema,
})
export type ServePollDraftResponse = z.infer<
  typeof ServePollDraftResponseSchema
>

export const ServePollAudienceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sample'),
    size: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('list'),
    voterFileFilterId: z.number().int().positive(),
  }),
])
export type ServePollAudience = z.infer<typeof ServePollAudienceSchema>

export const ServePollCreateSchema = z.object({
  topic: PollTopicSchema,
  tone: PollToneSchema.optional(),
  question: PollQuestionSchema,
  imageUrl: z.string().url().optional(),
  audience: ServePollAudienceSchema,
  scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  biasOverridden: z.boolean(),
})
export type ServePollCreate = z.infer<typeof ServePollCreateSchema>

export const ServePollExpansionCreateSchema = z.object({
  size: z.number().int().positive(),
})
export type ServePollExpansionCreate = z.infer<
  typeof ServePollExpansionCreateSchema
>

export const ServePollExpansionCreateResponseSchema = z.object({
  expansionId: z.string().min(1),
  recipientCount: z.number().int().nonnegative(),
  amountCents: z.number().int().nonnegative(),
})
export type ServePollExpansionCreateResponse = z.infer<
  typeof ServePollExpansionCreateResponseSchema
>

export const ReplyFlagUpdateSchema = z.object({
  favorited: z.boolean().optional(),
  read: z.boolean().optional(),
})
export type ReplyFlagUpdate = z.infer<typeof ReplyFlagUpdateSchema>
