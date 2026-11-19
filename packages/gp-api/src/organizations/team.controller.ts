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
  getTeam(@ReqOrganization() organization: Organization) {
    return this.team.listTeam(organization)
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
    // Team accounts are Win-only in Phase 1 (ENG-10816 non-goal: Serve
    // staff accounts are out of scope — every elected-office surface stays
    // owner-only via UseElectedOfficeGuard). A membership row on an eo- org
    // would half-work: org-scoped routes would admit the member, but no
    // Serve surface actually checks for anything but ownership — a broken
    // state Phase 1 must not create. This is the only route that can create
    // a membership row, so it's the only place this needs enforcing.
    if (organization.slug.startsWith('eo-')) {
      throw new BadRequestException(
        'Team accounts are not available for elected offices yet',
      )
    }
    if (organization.testModeCreatedAt) {
      throw new ConflictException(
        'Team invites are not available for test organizations',
      )
    }

    // Campaigns created on or after TEAM_GATE_START need the Team plan to
    // invite anyone. Earlier campaigns keep inviting on any plan. The flag is
    // read for the org owner so a manager's invite buckets with the owner.
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
        throw new ForbiddenException({
          message: 'Inviting teammates requires the Team plan',
          code: 'TEAM_PLAN_REQUIRED',
        })
      }
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
