import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  IdentifyOpponentsResponse,
  IdentifyOpponentsResponseSchema,
  OpponentProfileResponse,
  OpponentProfileResponseSchema,
  RaceOpponentReportResponse,
  RaceOpponentReportResponseSchema,
  RaceOpponentResearchStatusResponse,
  RaceOpponentResearchStatusResponseSchema,
  RaceOpponentActivityResponse,
  RaceOpponentActivityResponseSchema,
  RaceOpponentResponse,
  RaceOpponentResponseSchema,
  StartOpponentResearchRequest,
  StartOpponentResearchRequestSchema,
  StartOpponentResearchResponse,
  StartOpponentResearchResponseSchema,
  StartSelfResearchResponse,
  StartSelfResearchResponseSchema,
} from '@goodparty_org/contracts'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { RaceOpponentService } from './services/raceOpponent.service'
import { SelfResearchService } from './services/selfResearch.service'
import { SelfResearchGateService } from './services/selfResearchGate.service'
import { OpponentResearchService } from './services/opponentResearch.service'
import { RaceOpponentActivityService } from './services/raceOpponentActivity.service'
import {
  RaceOpponentCollectResponse,
  RaceOpponentCollectResponseSchema,
} from './schemas/raceOpponentCollect.schema'

@Controller('campaigns/mine/race-opponent')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class RaceOpponentController {
  constructor(
    private readonly raceOpponent: RaceOpponentService,
    private readonly selfResearch: SelfResearchService,
    private readonly selfResearchGate: SelfResearchGateService,
    private readonly opponentResearch: OpponentResearchService,
    private readonly activity: RaceOpponentActivityService,
  ) {}

  // collect is the functional opponent trigger (it dispatches opponent
  // discovery/collection runs), so PRD Requirement B's gate must hold here too,
  // not only on the identify stub: opponent research stays blocked until the
  // self-research pass has completed.
  @Post('collect')
  @ResponseSchema(RaceOpponentCollectResponseSchema)
  @UseCampaign({ include: { user: true } })
  async collect(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<RaceOpponentCollectResponse> {
    await this.selfResearchGate.assertSelfResearchComplete(campaign.id)
    return this.raceOpponent.collect(campaign)
  }

  @Get()
  @ResponseSchema(RaceOpponentResponseSchema)
  @UseCampaign({ include: { user: true } })
  async get(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<RaceOpponentResponse> {
    return this.raceOpponent.get(campaign)
  }

  @Post('self-research')
  @ResponseSchema(StartSelfResearchResponseSchema)
  @UseCampaign({ include: { user: true } })
  async startSelfResearch(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<StartSelfResearchResponse> {
    return this.selfResearch.start(campaign)
  }

  @Get('self-research/status')
  @ResponseSchema(RaceOpponentResearchStatusResponseSchema)
  @UseCampaign({ include: { user: true } })
  async selfResearchStatus(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<RaceOpponentResearchStatusResponse> {
    return this.selfResearch.status(campaign)
  }

  @Get('self-research/report')
  @ResponseSchema(RaceOpponentReportResponseSchema)
  @UseCampaign({ include: { user: true } })
  async selfResearchReport(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<RaceOpponentReportResponse> {
    return this.selfResearch.report(campaign)
  }

  // Self-research is the front door: opponent research is hard-gated server-side
  // on a completed self-research pass (PRD Requirement B). identify defaults the
  // opponent set from the election-api candidacy roster so the candidate
  // confirms a real match before research is dispatched. The gate throws 403
  // when self-research is not yet completed.
  @Post('opponents/identify')
  @ResponseSchema(IdentifyOpponentsResponseSchema)
  @UseCampaign({ include: { user: true } })
  async identifyOpponents(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<IdentifyOpponentsResponse> {
    return this.opponentResearch.identify(campaign)
  }

  // Dispatch requires candidate confirmation of the match: opponentName must be
  // supplied in the body. The service never auto-dispatches on an unconfirmed
  // namesake. Gated on Pro+flag AND a completed self-research pass.
  @Post('opponents/research')
  @ResponseSchema(StartOpponentResearchResponseSchema)
  @UseCampaign({ include: { user: true } })
  async startOpponentResearch(
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Body(new ZodValidationPipe(StartOpponentResearchRequestSchema))
    body: StartOpponentResearchRequest,
  ): Promise<StartOpponentResearchResponse> {
    return this.opponentResearch.start(campaign, body)
  }

  @Get('opponents/profile')
  @ResponseSchema(OpponentProfileResponseSchema)
  @UseCampaign({ include: { user: true } })
  async opponentProfile(
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Query('opponentName') opponentName: string,
  ): Promise<OpponentProfileResponse> {
    return this.opponentResearch.profile(campaign, opponentName ?? '')
  }

  // The "what's new" activity stream: opponent findings ordered by when they
  // occurred, each flagged newSinceLastVisit. Gated identically to the other
  // opponent paths. Viewing advances lastViewedAt so the next read's
  // new-since-last-visit is correct — it does NOT refresh research.
  @Get('opponents/activity')
  @ResponseSchema(RaceOpponentActivityResponseSchema)
  @UseCampaign({ include: { user: true } })
  async opponentActivity(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<RaceOpponentActivityResponse> {
    return this.activity.activity(campaign)
  }
}
