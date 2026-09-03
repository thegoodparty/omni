import { z } from 'zod'

// Roles an invite can carry. Owner is excluded on purpose: ownership is
// unique per org and only changes via the dedicated transfer endpoint, never
// an invite. Mirrors the values the `OrganizationRole` Prisma enum will hold
// (ENG-10817, not yet landed) — kept local here rather than imported since
// this schema ships first.
export const TEAM_INVITE_ROLE_VALUES = ['campaignAdmin', 'volunteer'] as const
export type TeamInviteRole = (typeof TEAM_INVITE_ROLE_VALUES)[number]
export const TeamInviteRoleSchema = z.enum(TEAM_INVITE_ROLE_VALUES)

// Clerk invitation publicMetadata. Clerk copies this onto the user at
// sign-up, which is the entire persistence mechanism for a pending invite —
// gp-api writes it, the webapp reads it off the Clerk user, and gp-api reads
// it back at accept.
export const TeamInviteMetadataSchema = z.object({
  organizationSlug: z.string(),
  role: TeamInviteRoleSchema,
  name: z.string(),
  invitedByUserId: z.number(),
})

export type TeamInviteMetadata = z.infer<typeof TeamInviteMetadataSchema>
