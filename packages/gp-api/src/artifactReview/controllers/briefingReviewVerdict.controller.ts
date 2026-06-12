import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { ElectedOffice } from '../../generated/prisma'
import {
  ArtifactReviewSchema,
  BriefingReviewLookupResponseSchema,
  SetArtifactReviewVerdictRequest,
  SetArtifactReviewVerdictRequestSchema,
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { IncomingRequest } from '@/authentication/authentication.types'
import {
  MeetingDateParam,
  MeetingDateParamSchema,
} from '@/meetings/schemas/meetingDateParam.schema'
import { BriefingReviewVerdictService } from '../services/briefingReviewVerdict.service'

@Controller('meetings/:date/briefing/review-verdict')
export class BriefingReviewVerdictController {
  constructor(private readonly verdicts: BriefingReviewVerdictService) {}

  @UseElectedOffice()
  @Get()
  @ResponseSchema(BriefingReviewLookupResponseSchema)
  async get(
    @Param(new ZodValidationPipe(MeetingDateParamSchema))
    { date }: MeetingDateParam,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Req() req: IncomingRequest,
  ) {
    const review = await this.verdicts.getForBriefing(
      date,
      electedOffice,
      req.actorSub ?? null,
    )
    return { review }
  }

  @UseElectedOffice()
  @Put()
  @ResponseSchema(ArtifactReviewSchema)
  put(
    @Param(new ZodValidationPipe(MeetingDateParamSchema))
    { date }: MeetingDateParam,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(SetArtifactReviewVerdictRequestSchema))
    body: SetArtifactReviewVerdictRequest,
    @Req() req: IncomingRequest,
  ) {
    return this.verdicts.setForBriefing({
      meetingDate: date,
      electedOffice,
      actorSub: req.actorSub ?? null,
      actorUser: req.actorUser ?? null,
      verdict: body.verdict,
      failReason: body.failReason,
    })
  }
}
