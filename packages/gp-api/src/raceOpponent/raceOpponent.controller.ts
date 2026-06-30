import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  ContrastResponse,
  ContrastResponseSchema,
  EditContrastRequest,
  EditContrastRequestSchema,
  GenerateContrastsResponse,
  GenerateContrastsResponseSchema,
  IdentifyOpponentsResponse,
  IdentifyOpponentsResponseSchema,
  ListContrastsResponse,
  ListContrastsResponseSchema,
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
  RaceOpponentReview,
  RaceOpponentReviewSchema,
  RouteContrastRequest,
  RouteContrastRequestSchema,
  RouteContrastResponse,
  RouteContrastResponseSchema,
  SetArtifactReviewVerdictRequest,
  SetArtifactReviewVerdictRequestSchema,
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
import { Roles } from '@/authentication/decorators/Roles.decorator'
import { UserRole } from '@/generated/prisma'
import { IncomingRequest } from '@/authentication/authentication.types'
import { effectiveUser } from '@/authentication/util/effectiveUser.util'
import { RaceOpponentService } from './services/raceOpponent.service'
import { SelfResearchService } from './services/selfResearch.service'
import { SelfResearchGateService } from './services/selfResearchGate.service'
import { OpponentResearchService } from './services/opponentResearch.service'
import { RaceOpponentActivityService } from './services/raceOpponentActivity.service'
import { ContrastEngineService } from './services/contrastEngine.service'
import { ContrastReviewVerdictService } from './services/contrastReviewVerdict.service'
import { ContrastRoutingService } from './services/contrastRouting.service'
import { ContrastEditService } from './services/contrastEdit.service'
import {
  RaceOpponentCollectResponse,
  RaceOpponentCollectResponseSchema,
} from './schemas/raceOpponentCollect.schema'
import {
  ManualOpponentsRequest,
  ManualOpponentsRequestSchema,
} from './schemas/manualOpponents.schema'

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
    private readonly contrastEngine: ContrastEngineService,
    private readonly contrastReviewVerdict: ContrastReviewVerdictService,
    private readonly contrastRouting: ContrastRoutingService,
    private readonly contrastEdit: ContrastEditService,
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

  // Manual opponent entry: when discovery finds nobody, the candidate names
  // opponents by hand (Lovable add-opponents screen) and runs collection on
  // them. Reconciles the names into the same store collect() reads, then
  // dispatches race_opponent_collection through the shared dispatch path. Gated
  // on Pro+flag inside collectManual (same assertAccess as the rest of the
  // module); unlike collect it does NOT require a completed self-research pass,
  // since manual entry is the candidate's own confirmed input.
  @Post('opponents/manual')
  @ResponseSchema(RaceOpponentCollectResponseSchema)
  @UseCampaign({ include: { user: true } })
  async collectManualOpponents(
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Body(new ZodValidationPipe(ManualOpponentsRequestSchema))
    body: ManualOpponentsRequest,
  ): Promise<RaceOpponentCollectResponse> {
    return this.raceOpponent.collectManual(campaign, body.opponents)
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

  // Pair opponent findings with the candidate's matching positions into
  // contrasts. Same Pro+flag+self-research gate as the rest of the module: the
  // contrast engine only runs once the candidate's own pass is done.
  @Post('contrasts/generate')
  @ResponseSchema(GenerateContrastsResponseSchema)
  @UseCampaign({ include: { user: true } })
  async generateContrasts(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<GenerateContrastsResponse> {
    await this.raceOpponent.assertAccess(campaign)
    await this.selfResearchGate.assertSelfResearchComplete(campaign.id)
    return this.contrastEngine.generate(campaign.id)
  }

  // Candidate read path: cleared/approved/used contrasts only. Near-the-line
  // (pending_review) and blocked contrasts are invisible here until a reviewer
  // verdict clears them.
  @Get('contrasts')
  @ResponseSchema(ListContrastsResponseSchema)
  @UseCampaign({ include: { user: true } })
  async listContrasts(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<ListContrastsResponse> {
    await this.raceOpponent.assertAccess(campaign)
    return this.contrastEngine.list(campaign.id)
  }

  // Route an approved contrast into Campaign Story or a draft texting Outreach.
  // DRAFT only — the route never sends; the candidate's own later action does.
  // Same Pro+flag+self-research gate and owner scope as the rest of the module.
  @Post('contrasts/:id/route')
  @ResponseSchema(RouteContrastResponseSchema)
  @UseCampaign({ include: { user: true } })
  async routeContrast(
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(RouteContrastRequestSchema))
    body: RouteContrastRequest,
  ): Promise<RouteContrastResponse> {
    await this.raceOpponent.assertAccess(campaign)
    await this.selfResearchGate.assertSelfResearchComplete(campaign.id)
    return this.contrastRouting.route(campaign, id, body.target)
  }

  // Candidate edits a contrast's text before routing it. Owner-scoped and gated
  // identically to the route path (Pro+flag+self-research). Only cleared or
  // approved contrasts are editable; the service increments editCount and fires
  // Win - Contrast Edited. Nothing sends — this only updates draft text.
  @Patch('contrasts/:id')
  @ResponseSchema(ContrastResponseSchema)
  @UseCampaign({ include: { user: true } })
  async editContrast(
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(EditContrastRequestSchema))
    body: EditContrastRequest,
  ): Promise<ContrastResponse> {
    await this.raceOpponent.assertAccess(campaign)
    await this.selfResearchGate.assertSelfResearchComplete(campaign.id)
    return this.contrastEdit.edit(campaign.id, campaign.userId, id, body)
  }

  // Reviewer (Campaign Success) applies the fair-line verdict. Admin-human-only
  // (@Roles), matching the briefing review precedent which is reviewer-only —
  // the verdict needs a reviewer identity, so a pure-M2M caller (no effective
  // user) must not reach it. This acts on a single contrast across campaigns,
  // not the owner's own, so it intentionally skips the @UseCampaign owner scope.
  @Put('contrasts/:id/review-verdict')
  @Roles(UserRole.admin)
  @ResponseSchema(RaceOpponentReviewSchema)
  applyContrastVerdict(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(SetArtifactReviewVerdictRequestSchema))
    body: SetArtifactReviewVerdictRequest,
    @Req() req: IncomingRequest,
  ): Promise<RaceOpponentReview> {
    const reviewer = effectiveUser(req)
    return this.contrastReviewVerdict.setForContrast({
      contrastId: id,
      reviewerSub: reviewer?.clerkId ?? null,
      reviewerUser: reviewer ?? null,
      verdict: body.verdict,
      failReason: body.failReason,
    })
  }
}
