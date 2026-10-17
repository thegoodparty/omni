import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseInterceptors,
} from '@nestjs/common'
import {
  type PollResults,
  PollResultsSchema,
  type ReplyFlag,
  ReplyFlagSchema,
  type ReplyFlagUpdate,
  ReplyFlagUpdateSchema,
  type ServePollCreate,
  type ServePollCreateResponse,
  ServePollCreateResponseSchema,
  ServePollCreateSchema,
  type ServePollExpansionCreate,
  type ServePollExpansionCreateResponse,
  ServePollExpansionCreateResponseSchema,
  ServePollExpansionCreateSchema,
  type ServePollDraftRequest,
  ServePollDraftRequestSchema,
  type ServePollDraftResponse,
  ServePollDraftResponseSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { PinoLogger } from 'nestjs-pino'
import { AnalyticsService } from '@/analytics/analytics.service'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { SERVE_SELF_SERVE_POLLS_FLAG } from '@/shared/util/serveSelfServePollsFlag.util'
import { EVENTS } from '@/vendors/segment/segment.types'
import { ElectedOffice, User } from '../generated/prisma'
import { OutreachPollResultsService } from './services/outreachPollResults.service'
import { OutreachServeComposeContextService } from './services/outreachServeComposeContext.service'
import { OutreachServePollCreateService } from './services/outreachServePollCreate.service'
import { OutreachServePollDraftService } from './services/outreachServePollDraft.service'
import { OutreachServePollExpansionService } from './services/outreachServePollExpansion.service'
import { OutreachSmsRepliesService } from './services/outreachSmsReplies.service'

// Serve self-serve polls. Ownership is the ElectedOffice row the guard
// resolves, never a client-supplied org. The flag gates rollout, not access:
// 404 rather than 403 when it is off, so a surface the user has not been
// rolled out to does not advertise that it exists.
@Controller('outreach/serve')
@UseElectedOffice()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachServePollController {
  constructor(
    private readonly pollResultsService: OutreachPollResultsService,
    private readonly repliesService: OutreachSmsRepliesService,
    private readonly features: FeaturesService,
    private readonly draftService: OutreachServePollDraftService,
    private readonly createService: OutreachServePollCreateService,
    private readonly expansionService: OutreachServePollExpansionService,
    private readonly profileContext: OutreachServeComposeContextService,
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
      this.createService.resolveOffice(electedOffice),
      this.profileContext.buildProfileContext(electedOffice.userId),
    ])
    return this.draftService.generateQuestion(
      input,
      office,
      String(user.id),
      context,
    )
  }

  // The bias check stays at POST /v1/polls/analyze-bias; the client calls it
  // directly, so nothing here re-runs it.
  @Post('poll')
  @ResponseSchema(ServePollCreateResponseSchema)
  async create(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(ServePollCreateSchema))
    input: ServePollCreate,
  ): Promise<ServePollCreateResponse> {
    await this.assertFeatureEnabled(user)
    const office = await this.createService.resolveOffice(electedOffice)
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

  @Post('poll/:id/expansions')
  @ResponseSchema(ServePollExpansionCreateResponseSchema)
  async createExpansion(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(ServePollExpansionCreateSchema))
    input: ServePollExpansionCreate,
  ): Promise<ServePollExpansionCreateResponse> {
    await this.assertFeatureEnabled(user)
    const created = await this.expansionService.createExpansion(
      electedOffice,
      id,
      input,
    )

    void this.analytics
      .track(user.id, EVENTS.Polls.GatherMoreStarted, {
        outreachId: id,
        expansionId: created.expansionId,
        recipientCount: created.recipientCount,
      })
      .catch(() => undefined)

    return created
  }

  @Get(':id/poll-results')
  @ResponseSchema(PollResultsSchema)
  async pollResults(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PollResults> {
    await this.assertFeatureEnabled(user)
    return this.pollResultsService.getResults(id, {
      organizationSlug: electedOffice.organizationSlug,
      campaignId: null,
    })
  }

  @Put(':id/replies/:replyId/flags')
  @ResponseSchema(ReplyFlagSchema)
  async updateReplyFlags(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param('id', ParseIntPipe) id: number,
    @Param('replyId') replyId: string,
    @Body(new ZodValidationPipe(ReplyFlagUpdateSchema))
    update: ReplyFlagUpdate,
  ): Promise<ReplyFlag> {
    await this.assertFeatureEnabled(user)
    return this.repliesService.updateFlags(
      id,
      replyId,
      { organizationSlug: electedOffice.organizationSlug, campaignId: null },
      user.id,
      update,
    )
  }
}
