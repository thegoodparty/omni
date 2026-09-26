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
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ElectedOffice, User } from '@/generated/prisma'
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
// This gates ROLLOUT, not authorization. @UseElectedOffice() is the real
// access check and stays that way whatever the flag says — which is also
// what keeps this Serve-only, since a Win org has no ElectedOffice row.
const SERVE_ISSUE_CAPTURE_FLAG = 'serve-issue-capture'

@Controller('constituent-feedback')
@UseElectedOffice()
@UseInterceptors(ZodResponseInterceptor)
export class ConstituentFeedbackController {
  constructor(
    private readonly feedback: ConstituentFeedbackService,
    private readonly features: FeaturesService,
  ) {}

  @Post()
  @ResponseSchema(RecordConstituentFeedbackResponseSchema)
  async capture(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(RecordConstituentFeedbackSchema))
    body: RecordConstituentFeedback,
  ) {
    await this.assertFeatureEnabled(user)

    return this.feedback.capture({
      organizationSlug: electedOffice.organizationSlug,
      actorUserId: user.id,
      body,
    })
  }

  @Patch(':id/confirm')
  @ResponseSchema(ConstituentFeedbackSchema)
  async confirm(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConfirmConstituentFeedbackSchema))
    body: ConfirmConstituentFeedback,
  ) {
    await this.assertFeatureEnabled(user)

    return this.feedback.confirm({
      organizationSlug: electedOffice.organizationSlug,
      id,
      body,
    })
  }

  @Get()
  @ResponseSchema(ConstituentFeedbackListResponseSchema)
  async list(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Query(new ZodValidationPipe(ListConstituentFeedbackQuerySchema))
    query: ListConstituentFeedbackQuery,
  ) {
    await this.assertFeatureEnabled(user)

    return {
      feedback: await this.feedback.listForPerson({
        organizationSlug: electedOffice.organizationSlug,
        personId: query.personId,
      }),
    }
  }

  // 404 rather than 403 when the flag is off: a surface the user has not been
  // rolled out to should not advertise that it exists.
  private async assertFeatureEnabled(user: User): Promise<void> {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: SERVE_ISSUE_CAPTURE_FLAG,
    })
    if (!enabled) throw new NotFoundException()
  }
}
