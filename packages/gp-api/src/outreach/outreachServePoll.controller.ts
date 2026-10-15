import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
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
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { SERVE_SELF_SERVE_POLLS_FLAG } from '@/shared/util/serveSelfServePollsFlag.util'
import { ElectedOffice, User } from '../generated/prisma'
import { OutreachPollResultsService } from './services/outreachPollResults.service'
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
  ) {}

  private async assertFeatureEnabled(user: User): Promise<void> {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: SERVE_SELF_SERVE_POLLS_FLAG,
    })
    if (!enabled) {
      throw new NotFoundException()
    }
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
