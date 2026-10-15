import {
  Body,
  Controller,
  NotFoundException,
  Post,
  UseInterceptors,
} from '@nestjs/common'
import {
  ServePollCreate,
  ServePollCreateResponse,
  ServePollCreateResponseSchema,
  ServePollCreateSchema,
  ServePollDraftRequest,
  ServePollDraftRequestSchema,
  ServePollDraftResponse,
  ServePollDraftResponseSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { PinoLogger } from 'nestjs-pino'
import { AnalyticsService } from '@/analytics/analytics.service'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { SERVE_SELF_SERVE_POLLS_FLAG } from '@/shared/util/serveSelfServePollsFlag.util'
import { EVENTS } from '@/vendors/segment/segment.types'
import { ElectedOffice, User } from '../generated/prisma'
import { OutreachServeComposeContextService } from './services/outreachServeComposeContext.service'
import { OutreachServePollCreateService } from './services/outreachServePollCreate.service'
import { OutreachServePollDraftService } from './services/outreachServePollDraft.service'

// The bias check stays at POST /v1/polls/analyze-bias; the client calls it
// directly, so nothing here re-runs it.
//
// Gates ROLLOUT, not authorization: @UseElectedOffice() is the access check,
// and the flag 404s rather than 403s so an office it is off for cannot tell
// the surface exists.
@Controller('outreach/serve')
@UseElectedOffice()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachServePollController {
  constructor(
    private readonly draftService: OutreachServePollDraftService,
    private readonly createService: OutreachServePollCreateService,
    private readonly profileContext: OutreachServeComposeContextService,
    private readonly organizations: OrganizationsService,
    private readonly features: FeaturesService,
    private readonly analytics: AnalyticsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachServePollController.name)
  }

  private async assertFeatureEnabled(user: User): Promise<void> {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: SERVE_SELF_SERVE_POLLS_FLAG,
    })
    if (!enabled) {
      throw new NotFoundException()
    }
  }

  // Office name is prompt enrichment only, so a lookup failure must not fail
  // the draft or the create; the text then names the official alone.
  private async resolveOffice(electedOffice: ElectedOffice): Promise<string> {
    try {
      return (
        (await this.organizations.resolvePositionNameByOrganizationSlug(
          electedOffice.organizationSlug,
        )) ?? ''
      )
    } catch (err) {
      this.logger.warn({ err }, 'office resolution failed for serve poll')
      return ''
    }
  }

  @Post('poll/draft')
  @ResponseSchema(ServePollDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(ServePollDraftRequestSchema))
    input: ServePollDraftRequest,
  ): Promise<ServePollDraftResponse> {
    await this.assertFeatureEnabled(user)
    const [office, context] = await Promise.all([
      this.resolveOffice(electedOffice),
      this.profileContext.buildProfileContext(electedOffice.userId),
    ])
    return this.draftService.generateQuestion(
      input,
      office,
      String(user.id),
      context,
    )
  }

  @Post('poll')
  @ResponseSchema(ServePollCreateResponseSchema)
  async create(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(ServePollCreateSchema))
    input: ServePollCreate,
  ): Promise<ServePollCreateResponse> {
    await this.assertFeatureEnabled(user)
    const office = await this.resolveOffice(electedOffice)
    const created = await this.createService.createPoll(
      electedOffice,
      user,
      office,
      input,
    )

    void this.analytics
      .track(user.id, EVENTS.Polls.PollCreated, {
        outreachId: created.outreachId,
        topic: input.topic,
        tone: input.tone,
        source: input.audience.kind,
        biasOverridden: input.biasOverridden,
      })
      .catch(() => undefined)

    return created
  }
}
