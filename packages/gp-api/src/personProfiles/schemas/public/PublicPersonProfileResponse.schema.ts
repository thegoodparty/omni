import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { zDate } from '@goodparty_org/contracts'
import { PersonProfileIssueStatus } from '../../../generated/prisma'

const AccomplishmentSchema = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
})

// Owner-authored "Recent Experience" rows. Mirrors the write-side
// RecentExperienceSchema (personProfile.schema.ts) but re-declared here so the
// public whitelist stays the single source of truth for what leaves the server.
const RecentExperienceSchema = z.object({
  title: z.string(),
  organization: z.string().nullable().optional(),
  term: z.string().nullable().optional(),
  source: z.enum(['ballotready', 'user']).nullable().optional(),
})

const PublicProfileIssueSchema = z.object({
  issueId: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  visible: z.boolean(),
  // Progress pill the profile owner set for this issue; null renders no pill.
  status: z.nativeEnum(PersonProfileIssueStatus).nullable(),
  transparency: z.string().nullable(),
  sortOrder: z.number().nullable(),
})

// Whitelist of product-owned fields safe to expose on the @PublicAccess() path.
// The global ZodResponseInterceptor strips anything not listed here, so owner-
// only fields (userId, deletedAt) never leave the server even if the row is
// returned. The election-api Person/OfficeHolder spine is fetched separately by
// the marketing site and composed at render time.
export const PublicPersonProfileResponseSchema = z.object({
  personId: z.string(),
  // Privacy takedown flag. When true the person has requested removal and the
  // marketing site renders the minimal "removal requested" states (K/L); all
  // authored/overlay content below is null in that case. Absent/false on a
  // normal live profile.
  removed: z.boolean().optional(),
  displayName: z.string().nullable(),
  roleTitleOverride: z.string().nullable(),
  bioOverride: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  whyRunning: z.string().nullable(),
  accomplishments: z.array(AccomplishmentSchema).nullable(),
  recentExperience: z.array(RecentExperienceSchema).nullable(),
  publicEmail: z.string().nullable(),
  publicPhone: z.string().nullable(),
  // Office contact overrides an owner can set (write schema accepts both). They
  // must be whitelisted here or the ZodResponseInterceptor strips them and the
  // owner's value can never reach the public page.
  officePhone: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  governmentWebsiteUrl: z.string().nullable(),
  instagramUrl: z.string().nullable(),
  tiktokUrl: z.string().nullable(),
  facebookUrl: z.string().nullable(),
  twitterUrl: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  defaultTransparency: z.string().nullable(),
  publishedAt: zDate().nullable(),
  updatedAt: zDate(),
  issues: z.array(PublicProfileIssueSchema),
})

export class PublicPersonProfileResponseDto extends createZodDto(
  PublicPersonProfileResponseSchema,
) {}

export type PublicPersonProfileResponse = z.infer<
  typeof PublicPersonProfileResponseSchema
>

// Minimal shape for the /people sitemap: identity + freshness only.
export const PublishedPersonProfileListSchema = z.array(
  z.object({
    personId: z.string(),
    updatedAt: zDate(),
  }),
)

export type PublishedPersonProfileList = z.infer<
  typeof PublishedPersonProfileListSchema
>
