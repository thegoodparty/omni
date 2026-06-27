import {
  Controller,
  Get,
  Post,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  IdentifyOpponentsResponse,
  IdentifyOpponentsResponseSchema,
  RaceOpponentReportResponse,
  RaceOpponentReportResponseSchema,
  RaceOpponentResearchStatusResponse,
  RaceOpponentResearchStatusResponseSchema,
  RaceOpponentResponse,
  RaceOpponentResponseSchema,
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
  // on a completed self-research pass (PRD Requirement B). This identify route
  // is the Phase-1 stub that proves the gate is enforced through a real route;
  // ENG-10569 fills in discovery. The gate throws 403 when self-research is not
  // yet completed.
  @Post('opponents/identify')
  @ResponseSchema(IdentifyOpponentsResponseSchema)
  @UseCampaign({ include: { user: true } })
  async identifyOpponents(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<IdentifyOpponentsResponse> {
    await this.selfResearchGate.assertSelfResearchComplete(campaign.id)
    return { opponentNames: [] }
  }
}
