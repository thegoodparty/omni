import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  forwardRef,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  AcceptInviteResponseSchema,
  InviteBlockReason,
  InviteMemberResponseSchema,
  MyPendingInviteResponseSchema,
  TeamResponseSchema,
  TEAM_GATE_START,
  TeamStatsResponseSchema,
} from '@goodparty_org/contracts'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { FeaturesService } from '@/features/services/features.service'
import { WrapperType } from '@/shared/types/utility.types'
import { WIN_PER_CAMPAIGN_PRICING_FLAG } from '@/shared/util/winPerCampaignPricingFlag.util'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { Organization, OrganizationRole, User } from '../generated/prisma'
import { AllowVolunteer } from './decorators/AllowVolunteer.decorator'
import { OwnerOnly } from './decorators/OwnerOnly.decorator'
import { ReqOrganization } from './decorators/ReqOrganization.decorator'
import { ReqOrganizationRole } from './decorators/ReqOrganizationRole.decorator'
import { UseOrganization } from './decorators/UseOrganization.decorator'
import {
  InviteTeamMemberDto,
  UpdateMemberRoleDto,
} from './schemas/inviteTeamMember.schema'
import { OrganizationTeamService } from './services/organizationTeam.service'
import { TeamStatsService } from './services/teamStats.service'

export const INVITE_GATE_TIMEOUT_MS = 1000

@Controller('organizations/team')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class TeamController {
  constructor(
    private readonly team: OrganizationTeamService,
    private readonly teamStats: TeamStatsService,
    @Inject(forwardRef(() => FeaturesService))
    private readonly features: WrapperType<FeaturesService>,
    @Inject(forwardRef(() => CampaignsService))
    private readonly campaigns: WrapperType<CampaignsService>,
  ) {}

  @Get()
  @UseOrganization()
  @ResponseSchema(TeamResponseSchema)
  async getTeam(@ReqOrganization() organization: Organization) {
    const [team, reason] = await Promise.all([
      this.team.listTeam(organization),
      this.getInviteBlockReasonWithin(organization, INVITE_GATE_TIMEOUT_MS),
    ])
    return { ...team, invites: { allowed: reason === null, reason } }
  }

  // A slow flag lookup must not hold up the member list. On timeout the page
  // shows Invite as allowed; POST still enforces the gate.
  private async getInviteBlockReasonWithin(
    organization: Organization,
    timeoutMs: number,
  ): Promise<InviteBlockReason | null> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs)
    })
    try {
      return await Promise.race([
        this.getInviteBlockReason(organization),
        timeout,
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  // The one predicate behind both POST team/invites and the `invites` field
  // on GET team, so the webapp renders exactly what the API will enforce.
  private async getInviteBlockReason(
    organization: Organization,
  ): Promise<InviteBlockReason | null> {
    // Team accounts are Win-only in Phase 1 (ENG-10816 non-goal: Serve
    // staff accounts are out of scope — every elected-office surface stays
    // owner-only via UseElectedOfficeGuard). A membership row on an eo- org
    // would half-work: org-scoped routes would admit the member, but no
    // Serve surface actually checks for anything but ownership — a broken
    // state Phase 1 must not create. Invites are the only route that can
    // create a membership row, so this is the only place it needs enforcing.
    if (organization.slug.startsWith('eo-')) return 'ELECTED_OFFICE'
    if (organization.testModeCreatedAt) return 'TEST_ORGANIZATION'

    // Campaigns created on or after TEAM_GATE_START need the Team plan to
    // invite anyone. Earlier campaigns keep inviting on any plan. The flag is
    // read for the org owner so a manager's view buckets with the owner.
    if (
      await this.features.isFeatureEnabled({
        user: organization.ownerId,
        feature: WIN_PER_CAMPAIGN_PRICING_FLAG,
      })
    ) {
      const campaign = await this.campaigns.findFirst({
        where: { organizationSlug: organization.slug },
        select: { createdAt: true, plan: true },
      })
      if (
        campaign &&
        campaign.createdAt >= new Date(TEAM_GATE_START) &&
        campaign.plan !== 'team'
      ) {
        return 'TEAM_PLAN_REQUIRED'
      }
    }
    return null
  }

  // Default posture (no @OwnerOnly()/@AllowVolunteer()) is exactly right:
  // owner or campaignAdmin, never a volunteer. No name/email/role in the
  // payload — the webapp joins by userId against GET /organizations/team.
  @Get('stats')
  @UseOrganization()
  @ResponseSchema(TeamStatsResponseSchema)
  getTeamStats(@ReqOrganization() organization: Organization) {
    return this.teamStats.getTeamStats(organization)
  }

  // Deliberately NOT @OwnerOnly(): "a manager can invite other managers" is
  // a stated ENG-10816 goal, so any resolved role (owner or campaignAdmin)
  // may invite — same reasoning as revokeInvite below being manager+
  // (delegate review, PR #1688).
  @Post('invites')
  @UseOrganization()
  @ResponseSchema(InviteMemberResponseSchema)
  async createInvite(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @ReqOrganizationRole() invitedByRole: OrganizationRole,
    @Body() input: InviteTeamMemberDto,
  ) {
    const reason = await this.getInviteBlockReason(organization)
    if (reason === 'ELECTED_OFFICE') {
      throw new BadRequestException(
        'Team accounts are not available for elected offices yet',
      )
    }
    if (reason === 'TEST_ORGANIZATION') {
      throw new ConflictException(
        'Team invites are not available for test organizations',
      )
    }
    if (reason === 'TEAM_PLAN_REQUIRED') {
      throw new ForbiddenException({
        message: 'Inviting teammates requires the Team plan',
        code: 'TEAM_PLAN_REQUIRED',
      })
    }

    return this.team.inviteMember({
      organization,
      invitedByUserId: user.id,
      invitedByRole,
      ...input,
    })
  }

  // Manager+ (no @OwnerOnly()), same as createInvite above.
  @Delete('invites/:id')
  @UseOrganization()
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvite(
    @ReqOrganization() organization: Organization,
    @Param('id') id: string,
  ): Promise<void> {
    await this.team.revokeInvite(organization, id)
  }

  // Session-only, same reasoning as accept below: it resolves only the
  // caller's own pending invite (no org scope exists yet).
  // A verified M2M token passes SessionGuard without populating
  // request.user — these session-only routes must tolerate that instead of
  // dereferencing undefined.
  @Get('invites/mine')
  @ResponseSchema(MyPendingInviteResponseSchema)
  getMyPendingInvite(@ReqUser() user: User | undefined) {
    return user ? this.team.getMyPendingInvite(user) : { invite: null }
  }

  @Post('invites/accept')
  @ResponseSchema(AcceptInviteResponseSchema)
  acceptInvite(@ReqUser() user: User | undefined) {
    if (!user) {
      throw new NotFoundException('No pending invitation found')
    }
    return this.team.acceptInvite(user)
  }

  @Patch('members/:userId')
  @UseOrganization()
  @OwnerOnly()
  updateMemberRole(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() input: UpdateMemberRoleDto,
  ) {
    return this.team.changeMemberRole({
      organization,
      actingUserId: user.id,
      targetUserId: userId,
      role: input.role,
    })
  }

  // ENG-11137: self-removal. Declared before members/:userId so `me` can
  // never reach the ParseIntPipe. The owner is rejected by removeMember's
  // existing owner check — ownership transfer is the only way an owner
  // leaves.
  @Delete('members/me')
  @UseOrganization()
  @AllowVolunteer()
  @HttpCode(HttpStatus.NO_CONTENT)
  async leaveOrganization(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
  ): Promise<void> {
    await this.team.removeMember({
      organization,
      actingUserId: user.id,
      targetUserId: user.id,
    })
  }

  @Delete('members/:userId')
  @UseOrganization()
  @OwnerOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<void> {
    await this.team.removeMember({
      organization,
      actingUserId: user.id,
      targetUserId: userId,
    })
  }
}
