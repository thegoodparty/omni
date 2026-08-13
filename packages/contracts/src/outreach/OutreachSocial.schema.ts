import { z } from 'zod'
import {
  OutreachStatusSchema,
  OutreachTypeSchema,
  SocialAssetKindSchema,
  SocialAssetPlatformSchema,
} from '../generated/enums'
import { zCoerceDate } from '../shared/Date.schema'

export const SOCIAL_PURPOSE_VALUES = [
  'introduce_myself',
  'persuade_voters',
  'event_invite',
  'early_voting',
  'election_day_turnout',
  'issue_update',
  'custom',
] as const
export const SocialPurposeSchema = z.enum(SOCIAL_PURPOSE_VALUES)
export type SocialPurpose = z.infer<typeof SocialPurposeSchema>

export const SOCIAL_TONE_VALUES = [
  'warm',
  'direct',
  'urgent',
  'friendly',
] as const
export const SocialToneSchema = z.enum(SOCIAL_TONE_VALUES)
export type SocialTone = z.infer<typeof SocialToneSchema>

export const SOCIAL_DRAFT_MESSAGE_MAX_LENGTH = 2000
export const SOCIAL_POST_COPY_MAX_LENGTH = 4000
export const SOCIAL_VIDEO_SCRIPT_MAX_LENGTH = 8000

export const SocialAssetSchema = z
  .object({
    platform: SocialAssetPlatformSchema,
    kind: SocialAssetKindSchema,
    text: z.string().min(1).max(SOCIAL_VIDEO_SCRIPT_MAX_LENGTH),
    caption: z
      .string()
      .max(SOCIAL_POST_COPY_MAX_LENGTH)
      .nullish()
      .transform((val) => val ?? null),
  })
  .refine(
    (asset) =>
      asset.kind !== 'post_copy' ||
      asset.text.length <= SOCIAL_POST_COPY_MAX_LENGTH,
    {
      message: `Post copy cannot exceed ${SOCIAL_POST_COPY_MAX_LENGTH} characters`,
    },
  )
export type SocialAsset = z.infer<typeof SocialAssetSchema>

// currentDraft switches the endpoint from writing a fresh draft to
// polishing the given text (keep meaning/structure/claims, apply tone).
export const SocialDraftRequestSchema = z.object({
  purpose: SocialPurposeSchema,
  tone: SocialToneSchema,
  currentDraft: z
    .string()
    .min(1)
    .max(SOCIAL_DRAFT_MESSAGE_MAX_LENGTH)
    .optional(),
})
export type SocialDraftRequest = z.infer<typeof SocialDraftRequestSchema>

export const SocialDraftResponseSchema = z.object({
  draft: z.string().min(1).max(SOCIAL_DRAFT_MESSAGE_MAX_LENGTH),
})
export type SocialDraftResponse = z.infer<typeof SocialDraftResponseSchema>

export const SocialGenerateRequestSchema = z.object({
  draftMessage: z.string().min(1).max(SOCIAL_DRAFT_MESSAGE_MAX_LENGTH),
  purpose: SocialPurposeSchema,
  platforms: z.array(SocialAssetPlatformSchema).min(1).max(6),
})
export type SocialGenerateRequest = z.infer<typeof SocialGenerateRequestSchema>

export const SocialGenerateResponseSchema = z.object({
  assets: z.array(SocialAssetSchema).min(1).max(6),
})
export type SocialGenerateResponse = z.infer<
  typeof SocialGenerateResponseSchema
>

export const SocialSaveRequestSchema = z.object({
  name: z.string().min(1).max(60),
  purpose: SocialPurposeSchema,
  draftMessage: z.string().min(1).max(SOCIAL_DRAFT_MESSAGE_MAX_LENGTH),
  assets: z.array(SocialAssetSchema).min(1).max(6),
})
export type SocialSaveRequest = z.infer<typeof SocialSaveRequestSchema>

export const OutreachSocialDetailSchema = z.object({
  purpose: z.string(),
  draftMessage: z.string(),
  assets: z.array(SocialAssetSchema),
})
export type OutreachSocialDetail = z.infer<typeof OutreachSocialDetailSchema>

export const OutreachDetailSchema = z.object({
  id: z.number(),
  createdAt: zCoerceDate(),
  updatedAt: zCoerceDate(),
  campaignId: z.number(),
  outreachType: OutreachTypeSchema,
  projectId: z.string().nullable(),
  name: z.string().nullable(),
  status: OutreachStatusSchema.nullable(),
  error: z.string().nullable(),
  audienceRequest: z.string().nullable(),
  script: z.string().nullable(),
  message: z.string().nullable(),
  date: zCoerceDate().nullable(),
  imageUrl: z.string().nullable(),
  voterFileFilterId: z.number().nullable(),
  doorKnockingRouteId: z.number().nullable(),
  phoneListId: z.number().nullable(),
  identityId: z.string().nullable(),
  didState: z.string().nullable(),
  didNpaSubset: z.array(z.string()),
  title: z.string().nullable(),
  textCount: z.number().nullable(),
  billableTextCount: z.number().nullable(),
  campaignPlanDueDate: z.string().nullable(),
  organizationSlug: z.string().nullable(),
  social: OutreachSocialDetailSchema.optional(),
})
export type OutreachDetail = z.infer<typeof OutreachDetailSchema>
