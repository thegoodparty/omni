import { z } from 'zod'
import {
  OutreachStatusSchema,
  OutreachTypeSchema,
  SocialAssetKindSchema,
  SocialAssetPlatformSchema,
  type SocialAssetKind,
  type SocialAssetPlatform,
} from '../generated/enums'
import { zCoerceDate } from '../shared/Date.schema'
import { PhoneBankingOutreachDetailSchema } from '../phoneBanking/PhoneBankingList.schema'
import { DoorKnockingOutreachDetailSchema } from '../doorKnocking/DoorKnockingTurf.schema'

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

// Serve's own purpose vocabulary (constituent framing, no election
// mechanics). Shared slugs (introduce_myself, event_invite, issue_update,
// custom) deliberately reuse the Win strings above — rows are disambiguated
// by scoping (campaignId vs organizationSlug), not by slug.
export const SERVE_SOCIAL_PURPOSE_VALUES = [
  'introduce_myself',
  'explain_decision',
  'event_invite',
  'community_input',
  'share_resource',
  'issue_update',
  'custom',
] as const
export const ServeSocialPurposeSchema = z.enum(SERVE_SOCIAL_PURPOSE_VALUES)
export type ServeSocialPurpose = z.infer<typeof ServeSocialPurposeSchema>

// Nextdoor purpose/surface availability matrix (ENG-10989, product/politics
// CSV 2026-09-01): Nextdoor bans telling neighbors how to vote, so a Win
// purpose that pairs persuasion or vote-timing language with Nextdoor is
// excluded outright. introduce_myself and custom stay INCLUDED with
// Nextdoor-specific handling instead (a vote-CTA-drop prompt override and a
// flag-don't-alter instruction, respectively) rather than exclusion — both
// live in outreachSocialGeneration.service.ts, not here. Serve carries no
// vote ask, so every Serve purpose is included.
export type SocialSurface = 'win' | 'serve'

export const WIN_SOCIAL_PLATFORM_EXCLUSIONS: Partial<
  Record<SocialPurpose, readonly SocialAssetPlatform[]>
> = {
  persuade_voters: ['nextdoor'],
  early_voting: ['nextdoor'],
  election_day_turnout: ['nextdoor'],
}

export const SERVE_SOCIAL_PLATFORM_EXCLUSIONS: Partial<
  Record<ServeSocialPurpose, readonly SocialAssetPlatform[]>
> = {}

export const SOCIAL_PLATFORM_EXCLUSION_REASON: Partial<
  Record<SocialAssetPlatform, string>
> = {
  nextdoor: "Nextdoor doesn't allow telling neighbors how to vote.",
}

export const excludedSocialPlatformsForPurpose = (
  surface: SocialSurface,
  purpose: SocialPurpose | ServeSocialPurpose,
): readonly SocialAssetPlatform[] =>
  (surface === 'win'
    ? WIN_SOCIAL_PLATFORM_EXCLUSIONS[purpose as SocialPurpose]
    : SERVE_SOCIAL_PLATFORM_EXCLUSIONS[purpose as ServeSocialPurpose]) ?? []

export const isSocialPlatformAllowed = (
  surface: SocialSurface,
  purpose: SocialPurpose | ServeSocialPurpose,
  platform: SocialAssetPlatform,
): boolean =>
  !excludedSocialPlatformsForPurpose(surface, purpose).includes(platform)

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

// Kind is a function of platform, not a client choice: the server persists
// the derived kind, so validation must run against the derivation too — a
// client-supplied mismatch (e.g. post_copy platform labeled video_script to
// dodge the shorter length cap) is rejected, not silently corrected.
export const SOCIAL_VIDEO_PLATFORMS = ['tiktok', 'youtube_shorts'] as const

export const socialAssetKindForPlatform = (
  platform: SocialAssetPlatform,
): SocialAssetKind =>
  (SOCIAL_VIDEO_PLATFORMS as readonly string[]).includes(platform)
    ? 'video_script'
    : 'post_copy'

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
    (asset) => asset.kind === socialAssetKindForPlatform(asset.platform),
    {
      message: 'Asset kind does not match its platform',
      path: ['kind'],
    },
  )
  .refine(
    (asset) =>
      socialAssetKindForPlatform(asset.platform) !== 'post_copy' ||
      asset.text.length <= SOCIAL_POST_COPY_MAX_LENGTH,
    {
      message: `Post copy cannot exceed ${SOCIAL_POST_COPY_MAX_LENGTH} characters`,
      path: ['text'],
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

// Serve request schemas mirror the Win ones above with the purpose field
// swapped to ServeSocialPurposeSchema.
export const ServeSocialDraftRequestSchema = z.object({
  purpose: ServeSocialPurposeSchema,
  tone: SocialToneSchema,
  currentDraft: z
    .string()
    .min(1)
    .max(SOCIAL_DRAFT_MESSAGE_MAX_LENGTH)
    .optional(),
})
export type ServeSocialDraftRequest = z.infer<
  typeof ServeSocialDraftRequestSchema
>

export const ServeSocialGenerateRequestSchema = z.object({
  draftMessage: z.string().min(1).max(SOCIAL_DRAFT_MESSAGE_MAX_LENGTH),
  purpose: ServeSocialPurposeSchema,
  platforms: z.array(SocialAssetPlatformSchema).min(1).max(6),
})
export type ServeSocialGenerateRequest = z.infer<
  typeof ServeSocialGenerateRequestSchema
>

export const ServeSocialSaveRequestSchema = z.object({
  name: z.string().min(1).max(60),
  purpose: ServeSocialPurposeSchema,
  draftMessage: z.string().min(1).max(SOCIAL_DRAFT_MESSAGE_MAX_LENGTH),
  assets: z.array(SocialAssetSchema).min(1).max(6),
})
export type ServeSocialSaveRequest = z.infer<
  typeof ServeSocialSaveRequestSchema
>

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
  // Null for a Serve org-only row (no campaign) — see the Win/Serve
  // isolation boundary in gp-api's src/outreach/AGENTS.md (ENG-10976).
  campaignId: z.number().nullable(),
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
  // .nullish() (not .nullable()): existing rows/fixtures predate this column
  // and omit the key entirely, not just send it null (ENG-10543 lesson).
  phoneBankingListId: z.number().nullish(),
  phoneListId: z.number().nullable(),
  identityId: z.string().nullable(),
  didState: z.string().nullable(),
  didNpaSubset: z.array(z.string()),
  title: z.string().nullable(),
  textCount: z.number().nullable(),
  billableTextCount: z.number().nullable(),
  campaignPlanDueDate: z.string().nullable(),
  organizationSlug: z.string().nullable(),
  archivedAt: zCoerceDate().nullable(),
  social: OutreachSocialDetailSchema.optional(),
  phoneBanking: PhoneBankingOutreachDetailSchema.optional(),
  // Present only on a nativeDoorKnocking row whose turf still resolves — a
  // tombstoned list leaves the envelope standing, and the drawer degrades to
  // the id-only rendering it had before this block existed.
  doorKnocking: DoorKnockingOutreachDetailSchema.optional(),
})
export type OutreachDetail = z.infer<typeof OutreachDetailSchema>
