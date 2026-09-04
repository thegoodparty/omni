import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import { OrganizationRoleSchema } from '../generated/enums'
import { TeamInviteRoleSchema } from './TeamInviteMetadata.schema'

// A persisted seat on the team: either the org owner (surfaced via the
// ownership fallback — owner never gets a real OrganizationMembership row)
// or a member with a role from OrganizationMembership.
export const TeamMemberSchema = z.object({
  userId: z.number(),
  name: z.string().nullable(),
  email: z.string(),
  role: OrganizationRoleSchema,
  createdAt: zCoerceDate(),
})

export type TeamMember = z.infer<typeof TeamMemberSchema>

// A Clerk invitation awaiting acceptance — never persisted in Postgres, so
// its role is restricted to what an invite can carry (never `owner`).
export const PendingInviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: TeamInviteRoleSchema,
  createdAt: zCoerceDate(),
})

export type PendingInvite = z.infer<typeof PendingInviteSchema>

export const TeamResponseSchema = z.object({
  members: z.array(TeamMemberSchema),
  pendingInvites: z.array(PendingInviteSchema),
})

export type TeamResponse = z.infer<typeof TeamResponseSchema>

// POST /organizations/team/invites returns one of two shapes depending on
// whether the invitee already had an account: a persisted member (direct
// add) or a pending Clerk invitation.
export const InviteMemberResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('added'), member: TeamMemberSchema }),
  z.object({ status: z.literal('pending'), invite: PendingInviteSchema }),
])

export type InviteMemberResponse = z.infer<typeof InviteMemberResponseSchema>

export const AcceptInviteResponseSchema = z.object({
  organizationSlug: z.string(),
  role: OrganizationRoleSchema,
})

export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>

// GET /organizations/team/invites/mine: the signed-in user's own pending
// invite, resolved server-side — the Clerk publicMetadata copy first, then
// the pending-invitation fallback by verified email for an invitee who
// signed up organically (ENG-11027). Null when none.
export const MyPendingInviteResponseSchema = z.object({
  invite: z
    .object({
      organizationSlug: z.string(),
      role: TeamInviteRoleSchema,
    })
    .nullable(),
})

export type MyPendingInviteResponse = z.infer<
  typeof MyPendingInviteResponseSchema
>
