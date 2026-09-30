import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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

@Controller('outreach')
@UseOrganization()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class OutreachAssignmentController {
  constructor(
    private readonly assignments: OutreachAssignmentService,
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
    const assignee = await this.assignments.assignValidated(
      organization.slug,
      outreachId,
      input.assigneeUserId,
      user.id,
    )

    void this.assignments
      .findOutreachTypeOrThrow(outreachId)
      .then((outreachType) =>
        this.analytics.track(user.id, EVENTS.Team.OutreachAssigned, {
          outreachId,
          outreachType,
          assigneeUserId: input.assigneeUserId,
        }),
      )
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

    void this.assignments
      .findOutreachTypeOrThrow(outreachId)
      .then((outreachType) =>
        this.analytics.track(user.id, EVENTS.Team.OutreachAssignmentRemoved, {
          outreachId,
          outreachType,
          assigneeUserId,
        }),
      )
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
