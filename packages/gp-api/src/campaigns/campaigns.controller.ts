import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import { McpTool } from '@/mcp/decorators/McpTool.decorator'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { IdParamSchema } from '@/shared/schemas/IdParam.schema'
import { PaginatedResponseSchema } from '@/shared/schemas/PaginatedResponse.schema'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import {
  CampaignWithLiveContextSchema,
  CampaignWithPositionNameSchema,
  FilingInstructionsContentSchema,
  ListCampaignsPaginationSchema,
  ReadCampaignOutputSchema,
  SetDistrictOutputSchema,
  UpdateCampaignM2MSchema,
} from '@goodparty_org/contracts'
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { Campaign, User, UserRole } from '../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import { createZodDto, ZodValidationPipe } from 'nestjs-zod'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { isTestUser, userHasRole } from 'src/users/util/users.util'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { ReqUser } from '../authentication/decorators/ReqUser.decorator'
import { Roles } from '../authentication/decorators/Roles.decorator'
import { ReqCampaign } from './decorators/ReqCampaign.decorator'
import { UseCampaign } from './decorators/UseCampaign.decorator'
import {
  CreateCampaignSchema,
  CreateFollowOnCampaignSchema,
  SetDistrictDTO,
  SetDistrictM2MDTO,
  UpdateCampaignSchema,
} from './schemas/updateCampaign.schema'
import { CampaignPlanVersionsService } from './services/campaignPlanVersions.service'
import { CampaignsService } from './services/campaigns.service'
import { EligibilityService } from './services/eligibility.service'
import { FilingInstructionsService } from './filingInstructions/filingInstructions.service'
import { CampaignWith } from './campaigns.types'
import { toCampaignGroupTraits } from './util/campaignGroupTraits.util'

class ListCampaignsPaginationDto extends createZodDto(
  ListCampaignsPaginationSchema,
) {}

class UpdateCampaignM2MDto extends createZodDto(UpdateCampaignM2MSchema) {}

@Controller('campaigns')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly planVersions: CampaignPlanVersionsService,
    private readonly slack: SlackService,
    private readonly organizations: OrganizationsService,
    private readonly analytics: AnalyticsService,
    private readonly filingInstructions: FilingInstructionsService,
    private readonly eligibility: EligibilityService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CampaignsController.name)
  }

  @Get('mine')
  @ResponseSchema(CampaignWithLiveContextSchema)
  @McpTool({
    description:
      "Read the calling user's active campaign, including organization and live status. " +
      'Use this on startup to understand who the user is, what office they are running for, ' +
      'and what state the campaign is in.',
  })
  @UseCampaign({ include: { organization: true } })
  async findMine(
    @ReqCampaign()
    campaign: CampaignWith<'organization'>,
  ) {
    const { organization: org } = campaign

    const [{ positionName }, liveMetrics] = await Promise.all([
      this.organizations.resolvePositionContext({
        customPositionName: org?.customPositionName,
        positionId: org?.positionId,
      }),
      this.campaigns.fetchLiveRaceTargetMetrics(campaign),
    ])

    return {
      ...campaign,
      positionName,
      raceTargetMetrics: liveMetrics,
    }
  }

  @UseGuards(M2MOnly)
  @Get('list')
  @ResponseSchema(PaginatedResponseSchema(CampaignWithPositionNameSchema))
  async list(@Query() query: ListCampaignsPaginationDto) {
    const { data, meta } = await this.campaigns.listCampaigns(query)

    const enriched = await Promise.all(
      data.map(async ({ organization, ...campaign }) => {
        const { positionName } =
          await this.organizations.resolvePositionContext({
            customPositionName: organization?.customPositionName,
            positionId: organization?.positionId,
          })
        return { ...campaign, positionName }
      }),
    )

    return { data: enriched, meta }
  }

  @Get('mine/status')
  @UseCampaign({ continueIfNotFound: true })
  async getUserCampaignStatus(@ReqCampaign() campaign?: Campaign) {
    return this.campaigns.getStatus(campaign)
  }

  @Get('mine/plan-version')
  @UseCampaign()
  async getCampaignPlanVersion(@ReqCampaign() campaign: Campaign) {
    const version = await this.planVersions.findByCampaignId(campaign.id)

    if (!version) throw new NotFoundException('No plan version found')

    return version.data
  }

  // The filing-instructions screen reads this fresh instead of the live
  // metrics carried on `GET mine` so the screen and the "email this to me"
  // body render from one source (and can't drift). Not isPro-gated for the
  // same reason as the email route below — see that comment.
  @Get('mine/filing-instructions')
  @ResponseSchema(FilingInstructionsContentSchema)
  @UseCampaign()
  async getFilingInstructions(@ReqCampaign() campaign: Campaign) {
    return this.filingInstructions.getContent(campaign)
  }

  // Intentionally @UseCampaign()-only, no isPro guard: the filing-instructions
  // screen is a PRE-payment step of the pro-upgrade wizard, so its audience is
  // by definition not-yet-Pro — an isPro gate would 403 the exact users it
  // serves. The payload is public BallotReady data already shown free in
  // onboarding (SuccessPage), and @UseCampaign() scopes the send to the
  // caller's own campaign + their own email. Per ENG-10325 AC.
  @Post('mine/filing-instructions/email')
  @UseCampaign()
  @HttpCode(HttpStatus.OK)
  async emailFilingInstructions(
    @ReqCampaign() campaign: Campaign,
    @ReqUser() user: User,
  ) {
    await this.filingInstructions.emailToCandidate(campaign, user)
    return { success: true }
  }

  // Test-only: flip the caller's own campaign to Pro without going through the
  // Stripe upgrade webhook. isPro is otherwise set only by that webhook, which
  // can't reach an ephemeral per-PR preview — so E2E specs that need a Pro Win
  // campaign (the Contacts pro-gated flows) had no way to provision one and were
  // stranded @dev-only. Hard-guarded so it can never grant Pro in production or
  // to a real user: fail-closed to a known non-prod deploy (so a misconfigured
  // or absent env denies rather than ungates), and only for test users
  // (isTestUser: e2e or QA fixture accounts) acting on their own campaign.
  @Post('mine/test-set-pro')
  @UseCampaign()
  @HttpCode(HttpStatus.OK)
  async testSetPro(@ReqCampaign() campaign: Campaign, @ReqUser() user: User) {
    if (!IS_NON_PROD_DEPLOY) {
      throw new ForbiddenException('Not available in this environment')
    }
    if (!user.email || !isTestUser({ email: user.email })) {
      throw new ForbiddenException('Test users only')
    }
    await this.campaigns.setIsPro(campaign.id, true, false)
    return { isPro: true }
  }

  @Get('slug/:slug')
  @Roles(UserRole.admin)
  async findBySlug(@Param('slug') slug: string) {
    const campaign = await this.campaigns.findFirst({
      where: { slug },
      include: {
        organization: {
          select: {
            customPositionName: true,
            positionId: true,
          },
        },
      },
    })

    if (!campaign) throw new NotFoundException()

    const [{ positionName }, liveMetrics] = await Promise.all([
      this.organizations.resolvePositionContext({
        customPositionName: campaign.organization?.customPositionName,
        positionId: campaign.organization?.positionId,
      }),
      this.campaigns.fetchLiveRaceTargetMetrics(campaign),
    ])

    return { ...campaign, positionName, raceTargetMetrics: liveMetrics }
  }

  @Post()
  async create(@ReqUser() user: User, @Body() body: CreateCampaignSchema) {
    const { canStartCampaign } = await this.eligibility.evaluate(user.id)
    if (!canStartCampaign) {
      throw new ConflictException(
        'User is not eligible to start a new campaign',
      )
    }
    return this.campaigns.createForUser(
      user,
      { details: body.details, data: body.data },
      {
        ballotReadyPositionId: body.ballotReadyPositionId ?? undefined,
        customPositionName: body.customPositionName ?? undefined,
      },
    )
  }

  // The write path behind the org switcher's "run for" actions. The UI hiding
  // these actions is cosmetic, so eligibility is re-checked here server-side
  // before any campaign is created.
  @Post('follow-on')
  @ResponseSchema(ReadCampaignOutputSchema)
  async createFollowOn(
    @ReqUser() user: User,
    @Body() body: CreateFollowOnCampaignSchema,
  ) {
    const eligibility = await this.eligibility.evaluate(user.id)
    if (!eligibility.canStartCampaign) {
      void this.analytics
        .track(user.id, EVENTS.Campaigns.FollowOnBlocked, {
          intent: body.intent,
          reason: 'active_campaign_exists',
        })
        .catch(() => undefined)
      throw new ConflictException(
        'User is not eligible to start a new campaign',
      )
    }

    return this.campaigns.createFollowOn(user, body, eligibility)
  }

  @Put('mine')
  @UseCampaign({ continueIfNotFound: true })
  async update(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @Body() dto: UpdateCampaignSchema,
  ) {
    const { slug, ...body } = dto

    // Presence, not truthiness: a truthiness check let any non-admin persist
    // `false` and silently revoke an admin-granted federal download grant.
    if (
      body.canDownloadFederal !== undefined &&
      !userHasRole(user, [UserRole.admin])
    ) {
      throw new ForbiddenException(
        'User does not have permission to change federal data access',
      )
    }

    const isAdminSlugOverride =
      typeof slug === 'string' &&
      campaign?.slug !== slug &&
      userHasRole(user, [UserRole.admin, UserRole.sales])

    if (isAdminSlugOverride) {
      campaign = await this.campaigns.findFirstOrThrow({
        where: { slug },
      })

      if (body?.details) {
        const { pledged } = body.details

        if (pledged) {
          await this.analytics.identify(campaign.userId, { pledged })
        }

        // Office / election date / party are per-campaign facts. Pinning them
        // to the user identity overwrites a prior campaign's values when the
        // user runs again, so they ride the org-scoped group() instead.
        await this.analytics.group(
          campaign.userId,
          campaign.organizationSlug,
          toCampaignGroupTraits(body.details),
        )
      }
    } else if (!campaign) throw new NotFoundException('Campaign not found')

    this.logger.debug({ campaign, ...{ slug, body } }, 'Updating campaign')

    // User-driven updates that move electionDate to a new upcoming date
    // clear stale prior-race result state (ENG-10954). Staff paths never get
    // this: the admin M2M update (PUT /:id) sets didWin explicitly, and the
    // slug-override branch here must not silently wipe a recorded result —
    // didWin isn't in UpdateCampaignSchema, so an admin couldn't re-supply
    // it through this endpoint.
    const updated = await this.campaigns.updateJsonFields(
      campaign.id,
      body,
      true,
      undefined,
      undefined,
      isAdminSlugOverride ? {} : { resetStaleElectionResults: true },
    )
    if (!updated) throw new NotFoundException('Campaign not found after update')
    return updated
  }

  @UseGuards(M2MOnly)
  @Get(':id')
  @ResponseSchema(CampaignWithLiveContextSchema)
  async findById(@Param() { id }: IdParamSchema) {
    const { organization, ...campaign } =
      await this.campaigns.findUniqueOrThrow({
        where: { id },
        include: {
          organization: {
            select: {
              customPositionName: true,
              positionId: true,
            },
          },
        },
      })

    const [{ positionName }, liveMetrics] = await Promise.all([
      this.organizations.resolvePositionContext({
        customPositionName: organization?.customPositionName,
        positionId: organization?.positionId,
      }),
      this.campaigns.fetchLiveRaceTargetMetrics(campaign),
    ])

    return { ...campaign, positionName, raceTargetMetrics: liveMetrics }
  }

  @UseGuards(M2MOnly)
  @Put(':id')
  @ResponseSchema(ReadCampaignOutputSchema)
  async updateCampaign(
    @Param() { id }: IdParamSchema,
    @Body() body: UpdateCampaignM2MDto,
  ) {
    await this.campaigns.findUniqueOrThrow({
      where: { id },
      select: { id: true },
    })

    const { data, details, aiContent, ...scalarFields } = body

    return this.campaigns.updateJsonFields(
      id,
      { data, details, aiContent },
      true,
      Object.values(scalarFields).some((v) => v !== undefined)
        ? scalarFields
        : undefined,
    )
  }

  @Post('launch')
  @UseCampaign()
  @HttpCode(HttpStatus.OK)
  async launch(@ReqCampaign() campaign: Campaign) {
    try {
      const launchResult = await this.campaigns.launch(campaign)
      return launchResult
    } catch (e) {
      this.logger.error({ e }, 'Error at campaign launch')
      await this.slack.errorMessage({
        message: 'Error at campaign launch',
        error: e,
      })

      throw e
    }
  }

  @Put('mine/district')
  @UseCampaign()
  @ResponseSchema(SetDistrictOutputSchema)
  async setDistrict(
    @ReqCampaign() campaign: Campaign,
    @ReqUser() user: User,
    @Body()
    {
      slug,
      L2DistrictType: l2DistrictType,
      L2DistrictName: l2DistrictName,
    }: SetDistrictDTO,
  ) {
    if (
      slug &&
      campaign?.slug !== slug &&
      userHasRole(user, [UserRole.admin, UserRole.sales])
    ) {
      campaign = await this.campaigns.findFirstOrThrow({
        where: { slug },
      })
    } else if (!campaign) throw new NotFoundException('Campaign not found')

    this.logger.debug(
      {
        campaign,
        ...{
          slug,
          L2DistrictType: l2DistrictType,
          L2DistrictName: l2DistrictName,
        },
      },
      'Updating campaign with district',
    )

    return this.applyDistrictUpdate(campaign, l2DistrictType, l2DistrictName)
  }

  private async applyDistrictUpdate(
    campaign: Campaign,
    l2DistrictType: string,
    l2DistrictName: string,
  ) {
    const campaignOrg = await this.organizations.findUnique({
      where: { slug: OrganizationsService.campaignOrgSlug(campaign.id) },
    })

    const overrideDistrictId =
      await this.organizations.resolveOverrideDistrictId({
        positionId: campaignOrg?.positionId ?? undefined,
        state: campaign.details?.state || '',
        L2DistrictType: l2DistrictType,
        L2DistrictName: l2DistrictName,
      })

    const updated = await this.campaigns.updateJsonFields(campaign.id, {
      overrideDistrictId,
    })
    if (!updated) throw new NotFoundException('Campaign not found after update')
    return updated
  }

  @UseGuards(M2MOnly)
  @Put(':id/district')
  @ResponseSchema(SetDistrictOutputSchema)
  async setDistrictM2M(
    @Param() { id }: IdParamSchema,
    @Body()
    {
      L2DistrictType: l2DistrictType,
      L2DistrictName: l2DistrictName,
    }: SetDistrictM2MDTO,
  ) {
    const campaign = await this.campaigns.findUniqueOrThrow({
      where: { id },
    })

    this.logger.debug(
      {
        campaignId: id,
        L2DistrictType: l2DistrictType,
        L2DistrictName: l2DistrictName,
      },
      'M2M: Updating campaign with district',
    )

    return this.applyDistrictUpdate(campaign, l2DistrictType, l2DistrictName)
  }
}
