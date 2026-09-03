import { BadGatewayException, Inject, Injectable } from '@nestjs/common'
import { ClerkClient, Invitation } from '@clerk/backend'
import { PinoLogger } from 'nestjs-pino'
import {
  TeamInviteMetadata,
  TeamInviteMetadataSchema,
} from '@goodparty_org/contracts'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { clerkCall } from '@/vendors/clerk/util/clerkCall.util'

// Thin wrapper over clerkClient.invitations.* — pending team invites live in
// Clerk, not Postgres (a pending invite is identity state, not a
// permission). publicMetadata is Clerk's whole persistence mechanism: it
// copies onto the user at sign-up, so the accept endpoint can read it back.
@Injectable()
export class ClerkInvitationsService {
  constructor(
    @Inject(CLERK_CLIENT_PROVIDER_TOKEN)
    private readonly clerkClient: ClerkClient,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ClerkInvitationsService.name)
  }

  async createTeamInvitation({
    emailAddress,
    redirectUrl,
    publicMetadata,
  }: {
    emailAddress: string
    redirectUrl: string
    publicMetadata: TeamInviteMetadata
  }): Promise<Invitation> {
    try {
      return await clerkCall(
        'invitations.createInvitation',
        { 'clerk.organization_slug': publicMetadata.organizationSlug },
        () =>
          this.clerkClient.invitations.createInvitation({
            emailAddress,
            redirectUrl,
            publicMetadata,
          }),
      )
    } catch (err) {
      this.logger.error({ err }, 'Failed to create Clerk team invitation')
      throw new BadGatewayException('Failed to create team invitation')
    }
  }

  async listPendingTeamInvitations(
    organizationSlug: string,
  ): Promise<Invitation[]> {
    let invitations: Invitation[]
    try {
      ;({ data: invitations } = await clerkCall(
        'invitations.getInvitationList',
        { 'clerk.organization_slug': organizationSlug },
        () =>
          this.clerkClient.invitations.getInvitationList({
            status: 'pending',
            // Clerk defaults to a 10-item page; without an explicit limit a
            // team past 10 pending invites would silently truncate here,
            // making the rest invisible and un-revocable. 500 is Clerk's
            // documented page-size ceiling.
            limit: 500,
          }),
      ))
    } catch (err) {
      this.logger.error({ err }, 'Failed to list Clerk team invitations')
      throw new BadGatewayException('Failed to list team invitations')
    }

    return invitations.filter((invitation) => {
      const metadata = TeamInviteMetadataSchema.safeParse(
        invitation.publicMetadata,
      )
      return (
        metadata.success && metadata.data.organizationSlug === organizationSlug
      )
    })
  }

  async revokeInvitation(invitationId: string): Promise<Invitation> {
    try {
      return await clerkCall(
        'invitations.revokeInvitation',
        { 'clerk.invitation_id': invitationId },
        () => this.clerkClient.invitations.revokeInvitation(invitationId),
      )
    } catch (err) {
      this.logger.error({ err }, 'Failed to revoke Clerk team invitation')
      throw new BadGatewayException('Failed to revoke team invitation')
    }
  }

  // Reads the invite payload straight off the invitee's own Clerk user —
  // Clerk copies an invitation's publicMetadata onto the user at sign-up, so
  // this is the only place the accept endpoint may read it from (never the
  // request body). A shape that doesn't parse (already accepted, cleared, or
  // never invited) is "no invite", not an error.
  async getTeamInviteMetadata(
    clerkId: string,
  ): Promise<TeamInviteMetadata | null> {
    let user
    try {
      user = await clerkCall(
        'users.getUser',
        { 'clerk.user_id': clerkId },
        () => this.clerkClient.users.getUser(clerkId),
      )
    } catch (err) {
      this.logger.error(
        { err },
        'Failed to fetch Clerk user for invite acceptance',
      )
      throw new BadGatewayException('Failed to fetch Clerk user')
    }

    const metadata = TeamInviteMetadataSchema.safeParse(user.publicMetadata)
    return metadata.success ? metadata.data : null
  }

  // Clears the invite keys after acceptance so the pending-invite payload
  // can't be read (or re-accepted against) again. Called after the DB
  // commit — a null here deletes the key rather than setting it, which is
  // Clerk metadata's merge-patch semantics.
  async clearTeamInviteMetadata(clerkId: string): Promise<void> {
    try {
      await clerkCall(
        'users.updateUserMetadata',
        { 'clerk.user_id': clerkId },
        () =>
          this.clerkClient.users.updateUserMetadata(clerkId, {
            publicMetadata: {
              organizationSlug: null,
              role: null,
              name: null,
              invitedByUserId: null,
            },
          }),
      )
    } catch (err) {
      this.logger.error({ err }, 'Failed to clear Clerk team invite metadata')
      throw new BadGatewayException('Failed to clear team invite metadata')
    }
  }
}
