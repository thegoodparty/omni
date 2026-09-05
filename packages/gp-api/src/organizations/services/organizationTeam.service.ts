import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { PinoLogger } from 'nestjs-pino'
import {
  AcceptedAssignment,
  AcceptInviteResponse,
  InviteMemberResponse,
  MyPendingInviteResponse,
  PendingInvite,
  TeamInviteMetadata,
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
import { CrmTeamMembersService } from '@/crm/crmTeamMembers.service'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { OutreachAssignmentService } from '@/outreach/services/outreachAssignment.service'
import { WrapperType } from '@/shared/types/utility.types'
import {
  Organization,
  OrganizationMembership,
  OrganizationRole,
  Prisma,
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
    private readonly crmTeamMembers: CrmTeamMembersService,
    @Inject(forwardRef(() => CampaignsService))
    private readonly campaigns: WrapperType<CampaignsService>,
    private readonly moduleRef: ModuleRef,
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
        outreachId: metadata.outreachId ?? null,
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
    outreachId?: number
  }): Promise<InviteMemberResponse> {
    const { organization, invitedByUserId, invitedByRole, name, role } = params
    const outreachId = params.outreachId
    const email = toLowerAndTrim(params.email)

    // Validated before anything is written or a Clerk invitation is sent —
    // the DTO refine already guarantees a volunteer invite carries an
    // outreachId, but never THIS org's outreach until checked here.
    if (outreachId !== undefined) {
      await this.resolveOutreachAssignments().assertOutreachInOrg(
        organization.slug,
        outreachId,
      )
    }

    const existingUser = await this.users.findUserByEmail(email)

    const response = existingUser
      ? await this.addExistingUserAsMember({
          organization,
          invitedByUserId,
          role,
          outreachId,
          existingUser,
        })
      : await this.createPendingInvite({
          organization,
          invitedByUserId,
          role,
          email,
          name,
          outreachId,
        })

    void this.analytics
      .track(invitedByUserId, EVENTS.Team.MemberInvited, {
        role,
        invitedByRole,
        listScoped: role === 'volunteer',
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
    const invitation = pending.find((invite) => invite.id === invitationId)
    if (!invitation) {
      throw new NotFoundException('Invitation not found')
    }

    await this.clerkInvitations.revokeInvitation(invitationId)

    // Best-effort: the invitation itself is already revoked at this point.
    // An invitee who already signed up via the link carries the same
    // publicMetadata on their own Clerk user — accept reads only that, so a
    // revoke that only cancels the invitation object leaves a revoked
    // invitee still able to accept. A failure here just means the metadata
    // clear didn't happen; the revoke itself must not be undone by it.
    try {
      await this.clerkInvitations.clearTeamInviteMetadataByEmail(
        invitation.emailAddress,
      )
    } catch (err) {
      this.logger.warn(
        { err, email: invitation.emailAddress },
        'Failed to clear team invite metadata for a revoked invitee',
      )
    }
  }

  async acceptInvite(user: User): Promise<AcceptInviteResponse> {
    // No Clerk identity, no invite — never reached in practice (accept is
    // authenticated), kept as a named guard rather than an unchecked lookup.
    if (!user.clerkId) {
      throw new NotFoundException('No pending invitation found')
    }

    const resolved = await this.resolvePendingInvite(user.clerkId)
    if (!resolved) {
      throw new NotFoundException('No pending invitation found')
    }
    const { metadata, invitationId } = resolved

    let membership: OrganizationMembership
    let assignedOutreachId: number | null = null
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

        if (metadata.outreachId !== undefined) {
          const assigned = await this.tryAssignOutreachInTx(
            tx,
            metadata,
            user.id,
          )
          if (assigned) assignedOutreachId = metadata.outreachId
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

      // The retried call's own transaction throws on the membership
      // create BEFORE tryAssignOutreachInTx ever runs, so this branch
      // can't rely on assignedOutreachId being set by this call — consult
      // the persisted row the WINNING call created instead. Response
      // source is always the DB, never re-derived from request state.
      if (metadata.outreachId !== undefined) {
        const alreadyAssigned =
          await this.resolveOutreachAssignments().existsFor(
            metadata.outreachId,
            user.id,
          )
        if (alreadyAssigned) assignedOutreachId = metadata.outreachId
      }
    }

    await this.clearInviteMetadata(user.clerkId)

    if (invitationId) {
      // Fallback path only: the membership came from the invitation object
      // itself (the user never carried the copied metadata), so retire the
      // invitation — otherwise it stays acceptable and keeps showing as
      // pending in the team list. Best-effort like the metadata clear: the
      // membership row is already the committed source of truth, and a
      // re-accept resolves to that row via the unique-constraint path.
      try {
        await this.clerkInvitations.revokeInvitation(invitationId)
      } catch (err) {
        this.logger.warn(
          { err, invitationId },
          'Failed to revoke a fallback-accepted Clerk invitation',
        )
      }
    }

    void this.syncTeamMemberToHubspot({
      organizationSlug: membership.organizationSlug,
      email: user.email,
      name: getUserFullName(user) || metadata.name,
      role: membership.role,
    })

    return {
      organizationSlug: membership.organizationSlug,
      role: membership.role,
      assignment:
        assignedOutreachId !== null
          ? await this.buildAcceptedAssignment(assignedOutreachId)
          : null,
    }
  }

  async getMyPendingInvite(user: User): Promise<MyPendingInviteResponse> {
    if (!user.clerkId) {
      return { invite: null }
    }
    const resolved = await this.resolvePendingInvite(user.clerkId)
    return {
      invite: resolved
        ? {
            organizationSlug: resolved.metadata.organizationSlug,
            role: resolved.metadata.role,
          }
        : null,
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

    void this.syncTeamMemberToHubspot({
      organizationSlug: organization.slug,
      email: updated.user.email,
      name: getUserFullName(updated.user) || null,
      role: updated.role,
      fromRole: existing.role,
    })

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
    const targetUser = await this.users.findUser({ id: targetUserId })

    // Assignments are access grants, not attribution (attribution lives on
    // the interaction rows' actorUserId) — removing a member deletes them
    // outright, in the same transaction as the membership row so a crash
    // between the two can never strand a former member's access.
    const outreachAssignments = this.resolveOutreachAssignments()
    await this.membership.client.$transaction(async (tx) => {
      await tx.organizationMembership.delete({ where: { id: existing.id } })
      await outreachAssignments.deleteAllForMember(
        organization.slug,
        targetUserId,
        tx,
      )
    })

    void this.analytics
      .track(actingUserId, EVENTS.Team.MemberRemoved, {
        role: existing.role,
      })
      .catch(() => undefined)

    if (targetUser) {
      void this.syncRemovalToHubspot({
        organizationSlug: organization.slug,
        email: targetUser.email,
        role: existing.role,
        userId: targetUserId,
      })
    }
  }

  // Resolved lazily via ModuleRef rather than injected: OutreachModule
  // imports OrganizationsModule (for @UseOrganization()), and OutreachModule's
  // own import graph (Payments -> Campaigns -> CampaignsAi, etc.) closes a
  // multi-module cycle a single forwardRef can't break — same reasoning as
  // RaceOpponentService in campaignIdeology.service.ts and
  // paymentEventsService.ts. Shared by removeMember (assignment cascade),
  // inviteMember (org-membership check on a list-scoped volunteer invite),
  // and acceptInvite (creating the assignment atomically with the
  // membership, ENG-11049).
  private resolveOutreachAssignments(): OutreachAssignmentService {
    return this.moduleRef.get(OutreachAssignmentService, { strict: false })
  }

  // Creates the volunteer's OutreachAssignment inside the same transaction as
  // the membership row it accompanies. An outreach deleted between invite
  // and accept is tolerated — the membership still commits, there's just no
  // assignment to route the volunteer to — but any other failure (a genuine
  // DB error, a cross-org mismatch that should never happen given the
  // invite-time check) propagates and rolls the whole accept back.
  private async tryAssignOutreachInTx(
    tx: Prisma.TransactionClient,
    metadata: TeamInviteMetadata,
    userId: number,
  ): Promise<boolean> {
    if (metadata.outreachId === undefined) return false
    try {
      await this.resolveOutreachAssignments().assign(
        metadata.organizationSlug,
        metadata.outreachId,
        userId,
        metadata.invitedByUserId,
        tx,
      )
      return true
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err
      this.logger.warn(
        { err, outreachId: metadata.outreachId },
        'Outreach for a volunteer invite was gone at accept; membership created without an assignment',
      )
      return false
    }
  }

  private async buildAcceptedAssignment(
    outreachId: number,
  ): Promise<AcceptedAssignment | null> {
    const outreach = await this.membership.client.outreach.findUnique({
      where: { id: outreachId },
      select: {
        id: true,
        outreachType: true,
        phoneBankingListId: true,
        doorKnockingRouteId: true,
      },
    })
    if (!outreach) return null
    return {
      outreachId: outreach.id,
      outreachType: outreach.outreachType,
      phoneBankingListId: outreach.phoneBankingListId,
      doorKnockingRouteId: outreach.doorKnockingRouteId,
    }
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
    outreachId?: number
    existingUser: User
  }): Promise<InviteMemberResponse> {
    const { organization, invitedByUserId, role, outreachId, existingUser } =
      params

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

    const membershipData = {
      organizationSlug: organization.slug,
      userId: existingUser.id,
      role,
      invitedByUserId,
    }
    // A list-scoped volunteer invite creates the membership and its
    // assignment atomically, the same guarantee accept gives the
    // Clerk-invitation branch — a crash between the two must never leave a
    // volunteer with a seat but no assigned list.
    const created =
      outreachId !== undefined
        ? await this.membership.client.$transaction(async (tx) => {
            const membership = await tx.organizationMembership.create({
              data: membershipData,
            })
            await this.resolveOutreachAssignments().assign(
              organization.slug,
              outreachId,
              existingUser.id,
              invitedByUserId,
              tx,
            )
            return membership
          })
        : await this.membership.model.create({ data: membershipData })

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

    void this.syncTeamMemberToHubspot({
      organizationSlug: organization.slug,
      email: existingUser.email,
      name: getUserFullName(existingUser) || null,
      role,
    })

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

  // How "does this signed-in user hold a pending invite" is answered: the
  // metadata Clerk copied onto their user at ticket sign-up wins; an
  // organically-signed-up invitee never got that copy (Clerk only copies it
  // when the account is created THROUGH the ticket), so fall back to the
  // pending invitation addressed to one of their Clerk-VERIFIED emails
  // (ENG-11027). Exactly one match redeems — zero or several (ambiguous)
  // resolve to none rather than guessing an org. A revoked invitation is
  // absent from the pending list, so revocation is honored for free.
  private async resolvePendingInvite(clerkId: string): Promise<{
    metadata: TeamInviteMetadata
    invitationId: string | null
  } | null> {
    const { metadata, verifiedEmails } =
      await this.clerkInvitations.getTeamInviteState(clerkId)
    if (metadata) {
      return { metadata, invitationId: null }
    }
    if (!verifiedEmails.length) {
      return null
    }

    const invitations = (
      await Promise.all(
        verifiedEmails.map((email) =>
          this.clerkInvitations.findPendingTeamInvitationsByEmail(email),
        ),
      )
    ).flat()

    // A user with multiple verified emails may hold one pending invite per
    // email. Ambiguity is measured in orgs, not invitations: matches that
    // all point to the same org are unambiguous (redeem the first); matches
    // spanning different orgs resolve to none rather than guessing.
    const candidates = invitations.flatMap((invitation) => {
      const parsed = TeamInviteMetadataSchema.safeParse(
        invitation.publicMetadata,
      )
      return parsed.success
        ? [{ metadata: parsed.data, invitationId: invitation.id }]
        : []
    })
    const [first] = candidates
    if (!first) {
      return null
    }
    const slugs = new Set(
      candidates.map((candidate) => candidate.metadata.organizationSlug),
    )
    return slugs.size === 1 ? first : null
  }

  private async createPendingInvite(params: {
    organization: Organization
    invitedByUserId: number
    role: TeamInviteRole
    email: string
    name: string
    outreachId?: number
  }): Promise<InviteMemberResponse> {
    const { organization, invitedByUserId, role, email, name, outreachId } =
      params

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
        outreachId,
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
        outreachId: outreachId ?? null,
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

  // ENG-10826: best-effort HubSpot contact sync. Membership truth is
  // Postgres, never HubSpot — a sync failure must never fail the
  // invite/accept/role-change request that already succeeded in Postgres.
  private async syncTeamMemberToHubspot(params: {
    organizationSlug: string
    email: string
    name: string | null
    role: OrganizationRole
    fromRole?: OrganizationRole
  }): Promise<void> {
    const { organizationSlug, ...member } = params
    try {
      const crmCompanyId = await this.resolveCrmCompanyId(organizationSlug)
      await this.crmTeamMembers.syncTeamMember({ ...member, crmCompanyId })
    } catch (err) {
      this.logger.warn(
        { err, email: params.email, organizationSlug },
        'Failed to sync team member contact to HubSpot',
      )
    }
  }

  // ENG-10826/ENG-11030: best-effort removal sync — archives the labeled
  // association for this campaign's company, and clears the shared
  // team_role property only once no team membership remains anywhere for
  // this user, since a role on a DIFFERENT campaign must not be blanked by
  // this org's removal.
  private async syncRemovalToHubspot(params: {
    organizationSlug: string
    email: string
    role: OrganizationRole
    userId: number
  }): Promise<void> {
    const { organizationSlug, email, role, userId } = params
    try {
      const [crmCompanyId, remainingMemberships] = await Promise.all([
        this.resolveCrmCompanyId(organizationSlug),
        this.membership.model.count({ where: { userId } }),
      ])
      await this.crmTeamMembers.removeTeamMemberAssociation({
        email,
        role,
        crmCompanyId,
        clearTeamRole: remainingMemberships === 0,
      })
    } catch (err) {
      this.logger.warn(
        { err, email, organizationSlug },
        'Failed to sync team member removal to HubSpot',
      )
    }
  }

  private async resolveCrmCompanyId(
    organizationSlug: string,
  ): Promise<string | null> {
    const campaign = await this.campaigns.findUnique({
      where: { organizationSlug },
    })
    const hubspotId = campaign?.data?.hubspotId
    return typeof hubspotId === 'string' ? hubspotId : null
  }
}
