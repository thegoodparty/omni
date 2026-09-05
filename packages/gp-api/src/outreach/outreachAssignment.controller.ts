import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  MyAssignmentsResponseSchema,
  type MyAssignmentsResponse,
  OutreachAssigneeSchema,
  type OutreachAssignee,
  OutreachAssigneesResponseSchema,
  type OutreachAssigneesResponse,
} from '@goodparty_org/contracts'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { AllowVolunteer } from '@/organizations/decorators/AllowVolunteer.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { Organization, User } from '../generated/prisma'
import { AssignOutreachDto } from './schemas/assignOutreach.schema'
import { OutreachAssignmentService } from './services/outreachAssignment.service'

// gp-api evaluates flags through the project's ANALYTICS key (see
// organizations/team.controller.ts) — Phase 1's team-accounts flag, not a
// separate volunteer flag. Gates only the create route, same reasoning as
// createInvite: without any assignment rows the flag being off makes every
// other route here inert.
const WIN_TEAM_ACCOUNTS_FLAG = 'win-team-accounts'

@Controller('outreach')
@UseOrganization()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class OutreachAssignmentController {
  constructor(
    private readonly assignments: OutreachAssignmentService,
    private readonly features: FeaturesService,
    private readonly analytics: AnalyticsService,
  ) {}

  // Declared ahead of :id/assignments below so Nest matches this literal
  // path first — otherwise "assignments/mine" would resolve as :id.
  @Get('assignments/mine')
  @AllowVolunteer()
  @ResponseSchema(MyAssignmentsResponseSchema)
  async getMine(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
  ): Promise<MyAssignmentsResponse> {
    const assignments = await this.assignments.listMineDetailed(
      organization.slug,
      user.id,
    )
    return { assignments }
  }

  @Post(':id/assignments')
  @ResponseSchema(OutreachAssigneeSchema)
  async assign(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Param('id', ParseIntPipe) outreachId: number,
    @Body() input: AssignOutreachDto,
  ): Promise<OutreachAssignee> {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: WIN_TEAM_ACCOUNTS_FLAG,
    })
    if (!enabled) {
      throw new NotFoundException()
    }

    const assignee = await this.assignments.assignValidated(
      organization.slug,
      outreachId,
      input.assigneeUserId,
      user.id,
    )

    const outreachType =
      await this.assignments.findOutreachTypeOrThrow(outreachId)
    void this.analytics
      .track(user.id, EVENTS.Team.OutreachAssigned, {
        outreachId,
        outreachType,
        assigneeUserId: input.assigneeUserId,
      })
      .catch(() => undefined)

    return assignee
  }

  @Delete(':id/assignments/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unassign(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Param('id', ParseIntPipe) outreachId: number,
    @Param('userId', ParseIntPipe) assigneeUserId: number,
  ): Promise<void> {
    await this.assignments.unassign(
      organization.slug,
      outreachId,
      assigneeUserId,
    )

    const outreachType =
      await this.assignments.findOutreachTypeOrThrow(outreachId)
    void this.analytics
      .track(user.id, EVENTS.Team.OutreachAssignmentRemoved, {
        outreachId,
        outreachType,
        assigneeUserId,
      })
      .catch(() => undefined)
  }

  @Get(':id/assignments')
  @ResponseSchema(OutreachAssigneesResponseSchema)
  async listForOutreach(
    @ReqOrganization() organization: Organization,
    @Param('id', ParseIntPipe) outreachId: number,
  ): Promise<OutreachAssigneesResponse> {
    const assignees = await this.assignments.listAssigneeDetails(
      organization.slug,
      outreachId,
    )
    return { assignees }
  }
}
