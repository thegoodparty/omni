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
}
