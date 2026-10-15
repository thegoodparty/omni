import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import { PollAudienceKindSchema } from '../generated/enums'

// The staff poll review queue (gp-admin). A row is either a poll's first send
// or one of its expansions. The M2M token identifies gp-admin, not the human,
// so the acting admin rides in the body, as in SmsAdminConsole.schema.ts.

export const POLL_QUEUE_KIND_VALUES = ['poll', 'expansion'] as const
export const PollQueueKindSchema = z.enum(POLL_QUEUE_KIND_VALUES)
export type PollQueueKind = z.infer<typeof PollQueueKindSchema>

export const POLL_APPROVAL_STATUS_VALUES = [
  'awaiting_review',
  'approved',
  'denied',
  'sent',
  'canceled',
] as const
export const PollApprovalStatusSchema = z.enum(POLL_APPROVAL_STATUS_VALUES)
export type PollApprovalStatus = z.infer<typeof PollApprovalStatusSchema>

export const PollQueueItemSchema = z.object({
  kind: PollQueueKindSchema,
  outreachId: z.number().int().positive(),
  expansionId: z.string().nullable(),
  organizationSlug: z.string(),
  name: z.string().nullable(),
  question: z.string().nullable(),
  topic: z.string(),
  textCount: z.number().int().nullable(),
  sendAt: zCoerceDate().nullable(),
  createdAt: zCoerceDate(),
  approvalStatus: PollApprovalStatusSchema,
  approvedAt: zCoerceDate().nullable(),
  approvedBy: z.string().nullable(),
  deniedAt: zCoerceDate().nullable(),
  deniedBy: z.string().nullable(),
  deniedReason: z.string().nullable(),
})
export type PollQueueItem = z.infer<typeof PollQueueItemSchema>

// The queue's tabs. Defaults to the rows awaiting review.
export const PollQueueQuerySchema = z.object({
  status: PollApprovalStatusSchema.default('awaiting_review'),
})
export type PollQueueQuery = z.infer<typeof PollQueueQuerySchema>

export const PollQueueResponseSchema = z.object({
  items: z.array(PollQueueItemSchema),
})
export type PollQueueResponse = z.infer<typeof PollQueueResponseSchema>

export const PollReviewDetailSchema = z.object({
  item: PollQueueItemSchema,
  // The full text as it will send: greeting, question and opt-out line.
  message: z.string().nullable(),
  imageUrl: z.string().nullable(),
  tone: z.string().nullable(),
  audienceKind: PollAudienceKindSchema,
  biasOverridden: z.boolean(),
  expansions: z.array(PollQueueItemSchema),
})
export type PollReviewDetail = z.infer<typeof PollReviewDetailSchema>

// `expansionId` approves one expansion instead of the first send.
export const ApprovePollRequestSchema = z.object({
  approvedBy: z.string().min(1).max(255),
  expansionId: z.string().min(1).optional(),
})
export type ApprovePollRequest = z.infer<typeof ApprovePollRequestSchema>

export const DenyPollRequestSchema = z.object({
  deniedBy: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000),
})
export type DenyPollRequest = z.infer<typeof DenyPollRequestSchema>

export const EditPollRequestSchema = z.object({
  question: z.string().min(10).max(480),
  editedBy: z.string().min(1).max(255),
})
export type EditPollRequest = z.infer<typeof EditPollRequestSchema>
