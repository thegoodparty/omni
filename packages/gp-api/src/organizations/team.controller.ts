import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  AcceptInviteResponseSchema,
  InviteMemberResponseSchema,
  TeamResponseSchema,
} from '@goodparty_org/contracts'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { Organization, OrganizationRole, User } from '../generated/prisma'
import { OwnerOnly } from './decorators/OwnerOnly.decorator'
import { ReqOrganization } from './decorators/ReqOrganization.decorator'
import { ReqOrganizationRole } from './decorators/ReqOrganizationRole.decorator'
import { UseOrganization } from './decorators/UseOrganization.decorator'
import {
  InviteTeamMemberDto,
  UpdateMemberRoleDto,
} from './schemas/inviteTeamMember.schema'
import { OrganizationTeamService } from './services/organizationTeam.service'

// gp-api evaluates flags through the project's ANALYTICS key — a flag
// created only in a dev Amplitude project does nothing here (features.service.ts).
const WIN_TEAM_ACCOUNTS_FLAG = 'win-team-accounts'

@Controller('organizations/team')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class TeamController {
  constructor(
    private readonly team: OrganizationTeamService,
    private readonly features: FeaturesService,
  ) {}

  @Get()
  @UseOrganization()
  @ResponseSchema(TeamResponseSchema)
  getTeam(@ReqOrganization() organization: Organization) {
    return this.team.listTeam(organization)
  }

  // The only route this flag gates: membership rows are created here (or by
  // accept, which is unreachable without an invite created here), so gating
  // just this route is what makes the whole feature inert at 0%.
  @Post('invites')
  @UseOrganization()
  @ResponseSchema(InviteMemberResponseSchema)
  async createInvite(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @ReqOrganizationRole() invitedByRole: OrganizationRole,
    @Body() input: InviteTeamMemberDto,
  ) {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: WIN_TEAM_ACCOUNTS_FLAG,
    })
    if (!enabled) {
      throw new NotFoundException()
    }

    return this.team.inviteMember({
      organization,
      invitedByUserId: user.id,
      invitedByRole,
      ...input,
    })
  }

  @Delete('invites/:id')
  @UseOrganization()
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvite(
    @ReqOrganization() organization: Organization,
    @Param('id') id: string,
  ): Promise<void> {
    await this.team.revokeInvite(organization, id)
  }

  // Ungated on purpose: invites cannot exist unless the flag was on when
  // they were created, so this is unreachable until then, and gating it
  // would strand an in-flight invitee if the flag ramps back down.
  @Post('invites/accept')
  @ResponseSchema(AcceptInviteResponseSchema)
  acceptInvite(@ReqUser() user: User) {
    return this.team.acceptInvite(user)
  }

  @Patch('members/:userId')
  @UseOrganization()
  @OwnerOnly()
  updateMemberRole(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Param('userId') userId: string,
    @Body() input: UpdateMemberRoleDto,
  ) {
    return this.team.changeMemberRole({
      organization,
      actingUserId: user.id,
      targetUserId: Number(userId),
      role: input.role,
    })
  }

  @Delete('members/:userId')
  @UseOrganization()
  @OwnerOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.team.removeMember({
      organization,
      actingUserId: user.id,
      targetUserId: Number(userId),
    })
  }
}
