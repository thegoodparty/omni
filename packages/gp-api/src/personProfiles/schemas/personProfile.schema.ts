import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

const AccomplishmentSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
})

// Editable surface for the profile owner. Publication state (publishedAt,
// deletedAt) is deliberately NOT writable here — it moves through the dedicated
// publish/unpublish/delete endpoints so each transition can fire a cache-bust.
const UpsertPersonProfileSchema = z
  .object({
    displayName: z.string().max(200).nullable().optional(),
    roleTitleOverride: z.string().max(200).nullable().optional(),
    bioOverride: z.string().max(5000).nullable().optional(),
    coverImageUrl: z.string().url().nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    whyRunning: z.string().max(5000).nullable().optional(),
    accomplishments: z.array(AccomplishmentSchema).nullable().optional(),
    publicEmail: z.string().email().nullable().optional(),
    publicPhone: z.string().max(40).nullable().optional(),
    websiteUrl: z.string().url().nullable().optional(),
    instagramUrl: z.string().url().nullable().optional(),
    tiktokUrl: z.string().url().nullable().optional(),
    facebookUrl: z.string().url().nullable().optional(),
    twitterUrl: z.string().url().nullable().optional(),
    linkedinUrl: z.string().url().nullable().optional(),
    defaultTransparency: z.string().max(100).nullable().optional(),
  })
  .strict()

const ProfileIssueInputSchema = z.object({
  issueId: z.string().min(1),
  visible: z.boolean().optional().default(true),
  transparency: z.string().max(100).nullable().optional(),
  sortOrder: z.number().int().nullable().optional(),
})

const SetProfileIssuesSchema = z
  .object({
    issues: z.array(ProfileIssueInputSchema),
  })
  .strict()

export class UpsertPersonProfileDto extends createZodDto(
  UpsertPersonProfileSchema,
) {}
export class SetProfileIssuesDto extends createZodDto(SetProfileIssuesSchema) {}

export type UpsertPersonProfileInput = z.infer<typeof UpsertPersonProfileSchema>
export type ProfileIssueInput = z.infer<typeof ProfileIssueInputSchema>
