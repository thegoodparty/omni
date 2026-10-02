import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common'
import {
  ConfirmConstituentFeedbackSchema,
  ConstituentFeedbackListResponseSchema,
  ConstituentFeedbackSchema,
  RecordConstituentFeedbackResponseSchema,
  RecordConstituentFeedbackSchema,
  type ConfirmConstituentFeedback,
  type RecordConstituentFeedback,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { AllowVolunteer } from '@/organizations/decorators/AllowVolunteer.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { ReqOrganizationRole } from '@/organizations/decorators/ReqOrganizationRole.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { Organization, OrganizationRole, User } from '@/generated/prisma'
import { ConstituentFeedbackService } from './services/constituentFeedback.service'
import {
  ListConstituentFeedbackQuerySchema,
  type ListConstituentFeedbackQuery,
} from './schemas/listConstituentFeedback.schema'

// Every route is gated, unlike the Serve SMS controller which gates only its
// writes. There is no inert read here: the reads ARE the feature, and a
// surface the user has not been rolled out to should not answer questions
// about it.
//
// This gates ROLLOUT, not authorization. @UseOrganization() and its role
// guard are the real access check and stay that way whatever the flag says.
// Each product rolls out on its own key, chosen by the org's product: an
// `eo-` slug is an elected official's office, anything else a campaign.
const SERVE_ISSUE_CAPTURE_FLAG = 'serve-issue-capture'
const WIN_ISSUE_CAPTURE_FLAG = 'win-issue-capture'

// The two writes carry @AllowVolunteer(), the posture of the knock and call
// routes they follow: the person who had the conversation is who records and
// confirms it, and on Win that is usually a volunteer. Like those routes, a
// volunteer reaches only an effort they are assigned to (the service checks).
// The read stays at the default, owner or campaign manager, because it is the
// CRM's record of a person.
@Controller('constituent-feedback')
@UseOrganization()
@UseInterceptors(ZodResponseInterceptor)
export class ConstituentFeedbackController {
  constructor(
    private readonly feedback: ConstituentFeedbackService,
    private readonly features: FeaturesService,
  ) {}

  @Post()
  @AllowVolunteer()
  @ResponseSchema(RecordConstituentFeedbackResponseSchema)
  async capture(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @ReqOrganizationRole() role: OrganizationRole,
    @Body(new ZodValidationPipe(RecordConstituentFeedbackSchema))
    body: RecordConstituentFeedback,
  ) {
    await this.assertFeatureEnabled(user, organization)

    return this.feedback.capture({
      organizationSlug: organization.slug,
      actorUserId: user.id,
      role,
      body,
    })
  }

  @Patch(':id/confirm')
  @AllowVolunteer()
  @ResponseSchema(ConstituentFeedbackSchema)
  async confirm(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @ReqOrganizationRole() role: OrganizationRole,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConfirmConstituentFeedbackSchema))
    body: ConfirmConstituentFeedback,
  ) {
    await this.assertFeatureEnabled(user, organization)

    return this.feedback.confirm({
      organizationSlug: organization.slug,
      id,
      actorUserId: user.id,
      role,
      body,
    })
  }

  @Get()
  @ResponseSchema(ConstituentFeedbackListResponseSchema)
  async list(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Query(new ZodValidationPipe(ListConstituentFeedbackQuerySchema))
    query: ListConstituentFeedbackQuery,
  ) {
    await this.assertFeatureEnabled(user, organization)

    return {
      feedback: await this.feedback.listForPerson({
        organizationSlug: organization.slug,
        personId: query.personId,
      }),
    }
  }

  // 404 rather than 403 when the flag is off: a surface the user has not been
  // rolled out to should not advertise that it exists.
  private async assertFeatureEnabled(
    user: User,
    organization: Organization,
  ): Promise<void> {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: organization.slug.startsWith('eo-')
        ? SERVE_ISSUE_CAPTURE_FLAG
        : WIN_ISSUE_CAPTURE_FLAG,
    })
    if (!enabled) throw new NotFoundException()
  }
}
