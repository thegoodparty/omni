import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  AcceptInviteResponse,
  InviteMemberResponse,
  PendingInvite,
  TeamInviteMetadataSchema,
  TeamInviteRole,
  TeamMember,
  TeamResponse,
} from '@goodparty_org/contracts'
import { EVENTS } from '@/vendors/segment/segment.types'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EmailService } from '@/email/email.service'
import { UsersService } from '@/users/services/users.service'
import { ClerkInvitationsService } from '@/vendors/clerk/services/clerkInvitations.service'
import { APP_ROOT } from '@/shared/util/appEnvironment.util'
import { toLowerAndTrim } from '@/shared/util/strings.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import {
  Organization,
  OrganizationMembership,
  OrganizationRole,
  User,
} from '../../generated/prisma'
import { getUserFullName } from '../../users/util/users.util'
import { OrganizationMembershipService } from './organizationMembership.service'
import { OrganizationsService } from './organizations.service'

@Injectable()
export class OrganizationTeamService {
  constructor(
    private readonly membership: OrganizationMembershipService,
    private readonly organizations: OrganizationsService,
    private readonly users: UsersService,
    private readonly clerkInvitations: ClerkInvitationsService,
    private readonly email: EmailService,
    private readonly analytics: AnalyticsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OrganizationTeamService.name)
  }

  async listTeam(organization: Organization): Promise<TeamResponse> {
    const [memberships, owner, invitations] = await Promise.all([
      this.membership.model.findMany({
        where: { organizationSlug: organization.slug },
        include: { user: true },
      }),
      this.users.findUser({ id: organization.ownerId }),
      this.clerkInvitations.listPendingTeamInvitations(organization.slug),
    ])

    // The owner FK is NOT NULL and cascades from User, so a missing owner
    // means the organization row itself is corrupt — not a case any caller
    // can recover from.
    if (!owner) {
      throw new InternalServerErrorException('Organization owner not found')
    }

    const members: TeamMember[] = [
      {
        userId: owner.id,
        name: getUserFullName(owner) || null,
        email: owner.email,
        role: OrganizationRole.owner,
        createdAt: organization.createdAt,
      },
      ...memberships.map((membership) => ({
        userId: membership.userId,
        name: getUserFullName(membership.user) || null,
        email: membership.user.email,
        role: membership.role,
        createdAt: membership.createdAt,
      })),
    ]

    const pendingInvites: PendingInvite[] = invitations.map((invitation) => {
      // Already filtered to valid, org-matching metadata by
      // listPendingTeamInvitations — parse (not safeParse) is safe here.
      const metadata = TeamInviteMetadataSchema.parse(invitation.publicMetadata)
      return {
        id: invitation.id,
        email: invitation.emailAddress,
        name: metadata.name,
        role: metadata.role,
        createdAt: new Date(invitation.createdAt),
      }
    })

    return { members, pendingInvites }
  }

  async inviteMember(params: {
    organization: Organization
    invitedByUserId: number
    invitedByRole: OrganizationRole
    email: string
    name: string
    role: TeamInviteRole
  }): Promise<InviteMemberResponse> {
    const { organization, invitedByUserId, invitedByRole, name, role } = params
    const email = toLowerAndTrim(params.email)
    const existingUser = await this.users.findUserByEmail(email)

    const response = existingUser
      ? await this.addExistingUserAsMember({
          organization,
          invitedByUserId,
          role,
          existingUser,
        })
      : await this.createPendingInvite({
          organization,
          invitedByUserId,
          role,
          email,
          name,
        })

    void this.analytics
      .track(invitedByUserId, EVENTS.Team.MemberInvited, {
        role,
        invitedByRole,
        listScoped: false,
      })
      .catch(() => undefined)

    return response
  }

  async revokeInvite(
    organization: Organization,
    invitationId: string,
  ): Promise<void> {
    const pending = await this.clerkInvitations.listPendingTeamInvitations(
      organization.slug,
    )
    if (!pending.some((invite) => invite.id === invitationId)) {
      throw new NotFoundException('Invitation not found')
    }

    await this.clerkInvitations.revokeInvitation(invitationId)
  }

  async acceptInvite(user: User): Promise<AcceptInviteResponse> {
    // No Clerk identity, no invite — never reached in practice (accept is
    // authenticated), kept as a named guard rather than an unchecked lookup.
    if (!user.clerkId) {
      throw new NotFoundException('No pending invitation found')
    }

    const metadata = await this.clerkInvitations.getTeamInviteMetadata(
      user.clerkId,
    )
    if (!metadata) {
      throw new NotFoundException('No pending invitation found')
    }

    let membership: OrganizationMembership
    try {
      membership = await this.membership.client.$transaction(async (tx) => {
        const created = await tx.organizationMembership.create({
          data: {
            organizationSlug: metadata.organizationSlug,
            userId: user.id,
            role: metadata.role,
            invitedByUserId: metadata.invitedByUserId,
          },
        })

        if (!getUserFullName(user)) {
          await tx.user.update({
            where: { id: user.id },
            data: { name: metadata.name },
          })
        }

        return created
      })

      void this.analytics
        .track(user.id, EVENTS.Team.InviteAccepted, { role: metadata.role })
        .catch(() => undefined)
    } catch (err) {
      // @@unique([organizationSlug, userId]) makes a double-accept (two
      // tabs, a retried request) a Prisma conflict rather than a second row
      // — read back the row the FIRST accept created instead of re-throwing.
      if (!isUniqueConstraintError(err)) {
        throw err
      }

      const existing = await this.membership.model.findUnique({
        where: {
          organizationSlug_userId: {
            organizationSlug: metadata.organizationSlug,
            userId: user.id,
          },
        },
      })
      if (!existing) {
        throw err
      }
      membership = existing
    }

    await this.clearInviteMetadata(user.clerkId)

    return {
      organizationSlug: membership.organizationSlug,
      role: membership.role,
    }
  }

  async changeMemberRole(params: {
    organization: Organization
    actingUserId: number
    targetUserId: number
    role: TeamInviteRole
  }): Promise<TeamMember> {
    const { organization, actingUserId, targetUserId, role } = params

    if (targetUserId === organization.ownerId) {
      throw new BadRequestException(
        "Cannot change the organization owner's role",
      )
    }

    const existing = await this.findMembershipOrThrow(
      organization.slug,
      targetUserId,
    )

    const updated = await this.membership.model.update({
      where: { id: existing.id },
      data: { role },
      include: { user: true },
    })

    void this.analytics
      .track(actingUserId, EVENTS.Team.RoleChanged, {
        fromRole: existing.role,
        toRole: updated.role,
      })
      .catch(() => undefined)

    return {
      userId: updated.userId,
      name: getUserFullName(updated.user) || null,
      email: updated.user.email,
      role: updated.role,
      createdAt: updated.createdAt,
    }
  }

  async removeMember(params: {
    organization: Organization
    actingUserId: number
    targetUserId: number
  }): Promise<void> {
    const { organization, actingUserId, targetUserId } = params

    if (targetUserId === organization.ownerId) {
      throw new BadRequestException('Cannot remove the organization owner')
    }

    const existing = await this.findMembershipOrThrow(
      organization.slug,
      targetUserId,
    )

    await this.membership.model.delete({ where: { id: existing.id } })

    void this.analytics
      .track(actingUserId, EVENTS.Team.MemberRemoved, {
        role: existing.role,
      })
      .catch(() => undefined)
  }

  private async findMembershipOrThrow(
    organizationSlug: string,
    userId: number,
  ): Promise<OrganizationMembership> {
    const existing = await this.membership.model.findUnique({
      where: { organizationSlug_userId: { organizationSlug, userId } },
    })
    if (!existing) {
      throw new NotFoundException('Member not found')
    }
    return existing
  }

  private async addExistingUserAsMember(params: {
    organization: Organization
    invitedByUserId: number
    role: TeamInviteRole
    existingUser: User
  }): Promise<InviteMemberResponse> {
    const { organization, invitedByUserId, role, existingUser } = params

    const existingMembership =
      existingUser.id === organization.ownerId
        ? null
        : await this.membership.model.findUnique({
            where: {
              organizationSlug_userId: {
                organizationSlug: organization.slug,
                userId: existingUser.id,
              },
            },
          })

    if (existingUser.id === organization.ownerId || existingMembership) {
      throw new ConflictException(
        'This person is already a member of the organization',
      )
    }

    const created = await this.membership.model.create({
      data: {
        organizationSlug: organization.slug,
        userId: existingUser.id,
        role,
        invitedByUserId,
      },
    })

    const campaignName =
      (await this.organizations.resolvePositionNameByOrganizationSlug(
        organization.slug,
      )) ?? organization.slug
    // Best-effort: the membership row above is already committed, so a
    // Mailgun outage must not 502 a request whose real effect succeeded —
    // that would read to the caller as a failed invite when it wasn't.
    try {
      await this.email.sendTeamMemberAddedEmail(existingUser, campaignName)
    } catch (err) {
      this.logger.warn(
        { err, userId: existingUser.id },
        'Failed to send team-member-added notification email',
      )
    }

    return {
      status: 'added',
      member: {
        userId: existingUser.id,
        name: getUserFullName(existingUser) || null,
        email: existingUser.email,
        role: created.role,
        createdAt: created.createdAt,
      },
    }
  }

  private async createPendingInvite(params: {
    organization: Organization
    invitedByUserId: number
    role: TeamInviteRole
    email: string
    name: string
  }): Promise<InviteMemberResponse> {
    const { organization, invitedByUserId, role, email, name } = params

    const pending = await this.clerkInvitations.listPendingTeamInvitations(
      organization.slug,
    )
    if (pending.some((invite) => invite.emailAddress.toLowerCase() === email)) {
      throw new ConflictException(
        'An invitation is already pending for this email',
      )
    }

    const invitation = await this.clerkInvitations.createTeamInvitation({
      emailAddress: email,
      redirectUrl: `${APP_ROOT}/team-invite`,
      publicMetadata: {
        organizationSlug: organization.slug,
        role,
        name,
        invitedByUserId,
      },
    })

    return {
      status: 'pending',
      invite: {
        id: invitation.id,
        email: invitation.emailAddress,
        name,
        role,
        createdAt: new Date(invitation.createdAt),
      },
    }
  }

  private async clearInviteMetadata(clerkId: string): Promise<void> {
    try {
      await this.clerkInvitations.clearTeamInviteMetadata(clerkId)
    } catch (err) {
      this.logger.warn(
        { err, clerkId },
        'Failed to clear Clerk team invite metadata; next accept will retry',
      )
    }
  }
}
