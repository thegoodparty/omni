import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { CampaignTcrComplianceService } from './services/campaignTcrCompliance.service'
import { ComplianceStateService } from './services/complianceState.service'
import { CreateTcrComplianceDto } from './schemas/createTcrComplianceDto.schema'
import { CreateAgenticTcrComplianceDto } from './schemas/createAgenticTcrComplianceDto.schema'
import { UseCampaign } from '../decorators/UseCampaign.decorator'
import { ReqCampaign } from '../decorators/ReqCampaign.decorator'
import { Campaign, TcrComplianceStatus, User } from '../../generated/prisma'
import { UsersService } from '../../users/services/users.service'
import { ZodValidationPipe } from 'nestjs-zod'
import { CampaignsService } from '../services/campaigns.service'
import { SubmitCampaignVerifyPinDto } from './schemas/submitCampaignVerifyPinDto.schema'
import { ReqUser } from '../../authentication/decorators/ReqUser.decorator'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { PinoLogger } from 'nestjs-pino'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { McpTool } from '@/mcp/decorators/McpTool.decorator'
import {
  ComplianceStateOutputSchema,
  SubmitToPeerlyOutputSchema,
} from '@goodparty_org/contracts'

@Controller('campaigns/tcr-compliance')
@UsePipes(ZodValidationPipe)
export class CampaignTcrComplianceController {
  constructor(
    private readonly userService: UsersService,
    private readonly tcrComplianceService: CampaignTcrComplianceService,
    private readonly complianceStateService: ComplianceStateService,
    private readonly campaignsService: CampaignsService,
    private readonly analytics: AnalyticsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CampaignTcrComplianceController.name)
  }

  @Get('mine')
  @UseCampaign()
  async getMyTcrCompliance(@ReqCampaign() campaign: Campaign) {
    return this.tcrComplianceService.fetchByCampaignId(campaign.id)
  }

  @Get('mine/compliance-state')
  @UseCampaign()
  @UseInterceptors(ZodResponseInterceptor)
  @ResponseSchema(ComplianceStateOutputSchema)
  @McpTool({
    description:
      "Read the calling campaign's full compliance-setup pipeline " +
      'state: which stages are completed, in progress, or pending ' +
      '(profile, domain purchase, domain verification, website ' +
      'publish, TCR submission, CV PIN entry). Call this at the start ' +
      'of every compliance_setup agent run to decide which steps to ' +
      'skip and which still need work; the response is the canonical ' +
      'view across Campaign, Website, Domain, and TcrCompliance ' +
      'tables, so the agent does not have to read those individually. ' +
      'Read-only; safe to call repeatedly during a run.',
  })
  async getMyComplianceState(@ReqCampaign() campaign: Campaign) {
    return this.complianceStateService.findStateForCampaign(campaign.id)
  }

  // Admin (gp-admin via M2M) view of any campaign's compliance state — same
  // payload as `mine/compliance-state`, without the session-campaign scoping.
  @Get('admin/:campaignId/compliance-state')
  @UseGuards(AdminOrM2MGuard)
  @UseInterceptors(ZodResponseInterceptor)
  @ResponseSchema(ComplianceStateOutputSchema)
  async getComplianceStateForCampaign(
    @Param('campaignId', ParseIntPipe) campaignId: number,
  ) {
    return this.complianceStateService.findStateForCampaign(campaignId)
  }

  @Post('admin/:campaignId/resend-cv-pin')
  @UseGuards(AdminOrM2MGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async resendCampaignVerifyPinForCampaign(
    @Param('campaignId', ParseIntPipe) campaignId: number,
  ) {
    const campaign = await this.campaignsService.findUniqueOrThrow({
      where: { id: campaignId },
    })
    await this.tcrComplianceService.resendCampaignVerifyPin(campaign)
  }

  // Admin "treat as 10DLC approved (internal testing)" checkbox. Creates an
  // approved TcrCompliance row with no Peerly identity for an internal
  // (@goodparty.org / @test.goodparty.org) account, so UI gates pass while
  // real P2P sends stay blocked. Refuses (409) when real compliance exists.
  @Post('admin/:campaignId/internal-testing-approval')
  @UseGuards(AdminOrM2MGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async grantInternalTestingApproval(
    @Param('campaignId', ParseIntPipe) campaignId: number,
  ) {
    const campaign = await this.campaignsService.findUniqueOrThrow({
      where: { id: campaignId },
    })
    const user = await this.userService.findByCampaign(campaign)
    if (!user) {
      throw new NotFoundException('User not found for this campaign')
    }
    await this.tcrComplianceService.grantInternalTestingApproval(user, campaign)
  }

  @Delete('admin/:campaignId/internal-testing-approval')
  @UseGuards(AdminOrM2MGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInternalTestingApproval(
    @Param('campaignId', ParseIntPipe) campaignId: number,
  ) {
    await this.campaignsService.findUniqueOrThrow({
      where: { id: campaignId },
    })
    await this.tcrComplianceService.revokeInternalTestingApproval(campaignId)
  }

  @Post('submit-to-peerly')
  @UseCampaign()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(ZodResponseInterceptor)
  @ResponseSchema(SubmitToPeerlyOutputSchema)
  @McpTool({
    description:
      "Submit the candidate's TCR/Identity registration to Peerly for " +
      '10DLC compliance. Precondition (enforced by the route): the ' +
      'compliance stage must be `awaiting_pin` — i.e., the domain is ' +
      "registered and the candidate's website is published and " +
      'verified live, AND the website content is genuine (a real bio ' +
      'of at least 500 characters and at least one real, non-template ' +
      'issue). Calls with any earlier stage return 422; calls with ' +
      'generic or template content return 400. ' +
      'No request body is needed: gp-api reads the EIN, committee name, ' +
      'office level, election filing details, contact email and phone, ' +
      "and website host from the candidate's saved compliance record — " +
      'just call it for the current campaign. gp-api re-validates the ' +
      'saved filing URL and returns 400 if it is a goodparty.org page, ' +
      "the candidate's own campaign website, or (for non-federal " +
      'candidates) an FEC filing URL (CampaignVerify rejects all of ' +
      'those); the candidate must correct their saved filing details ' +
      'before this can succeed. A 400 from this tool — including a ' +
      'CampaignVerify rejection of the submitted data — is never ' +
      'transient: do not retry it; record it as a rejection blocker. ' +
      'Creates the Peerly Identity, Identity Profile, ' +
      '10DLC Brand, and Campaign Verify Request; Peerly then sends a ' +
      'PIN to the candidate via the contact channels supplied. ' +
      'Returns the Peerly identity id, CV verification id, derived ' +
      'compliance stage (`awaiting_pin`), and the PIN delivery ' +
      'channels (from the persisted record) the candidate should ' +
      'check. Idempotent on retry: a second call returns the existing ' +
      'record without re-submitting to Peerly.',
  })
  async submitToPeerly(@ReqCampaign() campaign: Campaign) {
    const user = await this.userService.findByCampaign(campaign)
    if (!user) {
      throw new NotFoundException('User not found for this campaign')
    }

    return this.tcrComplianceService.submitToPeerlyForAgent(user, campaign)
  }

  @Post('agentic')
  @UseCampaign()
  @HttpCode(HttpStatus.ACCEPTED)
  async createAgenticTcrCompliance(
    @ReqCampaign() campaign: Campaign,
    @Body()
    tcrComplianceDto: CreateAgenticTcrComplianceDto,
  ) {
    const user = await this.userService.findByCampaign(campaign)
    if (!user) {
      throw new NotFoundException('User not found for this campaign')
    }

    const { record, created } = await this.tcrComplianceService.createAgentic(
      user,
      campaign,
      tcrComplianceDto,
    )

    if (created) {
      try {
        await this.analytics.track(
          user.id,
          EVENTS.Outreach.ComplianceFormSubmitted,
          { source: 'agentic_compliance_flow' },
        )
      } catch (e) {
        this.logger.error(
          { e },
          `Failed to track agentic compliance form submitted event for user ${user.id}`,
        )
      }
    }

    return record
  }

  @Post()
  @UseCampaign()
  async createTcrCompliance(
    @ReqCampaign() campaign: Campaign,
    @Body()
    tcrComplianceDto: CreateTcrComplianceDto,
  ) {
    if (await this.tcrComplianceService.fetchByCampaignId(campaign.id)) {
      throw new ConflictException(
        'TCR compliance already exists for this campaign',
      )
    }

    const { placeId, formattedAddress, ...tcrComplianceCreatePayload } =
      tcrComplianceDto
    const { ein, committeeName } = tcrComplianceCreatePayload
    const user = await this.userService.findByCampaign(campaign)

    if (!user) {
      throw new NotFoundException('User not found for this campaign')
    }

    const updatedCampaign = await this.campaignsService.updateJsonFields(
      campaign.id,
      {
        details: {
          einNumber: ein,
          campaignCommittee: committeeName,
        },
        placeId,
        formattedAddress,
      },
    )

    if (!updatedCampaign) {
      throw new InternalServerErrorException(
        'Failed to update campaign details',
      )
    }

    const result = await this.tcrComplianceService.create(
      user,
      updatedCampaign,
      tcrComplianceCreatePayload,
    )

    try {
      await this.analytics.track(
        user.id,
        EVENTS.Outreach.ComplianceFormSubmitted,
        { source: 'compliance_flow' },
      )
    } catch (e) {
      this.logger.error(
        { e },
        `Failed to track compliance form submitted event for user ${user.id}`,
      )
    }

    return result
  }

  private readonly retrieveTcrCompliance = async (
    tcrComplianceId: string,
    campaign: Campaign,
  ) => {
    const tcrCompliance = await this.tcrComplianceService.fetchByCampaignId(
      campaign.id,
    )
    if (!tcrCompliance) {
      throw new NotFoundException(
        'TCR compliance does not exist for this campaign',
      )
    }
    if (tcrCompliance.id !== tcrComplianceId) {
      throw new ForbiddenException(
        'TCR compliance ID does not match the campaign ID',
      )
    }
    return tcrCompliance
  }

  @Post(':id/submit-cv-pin')
  @UseCampaign()
  @HttpCode(HttpStatus.OK)
  async submitCampaignVerifyPIN(
    @Param('id') tcrComplianceId: string,
    @Body() { pin }: SubmitCampaignVerifyPinDto,
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
  ) {
    const tcrCompliance = await this.retrieveTcrCompliance(
      tcrComplianceId,
      campaign,
    )

    const campaignVerifyToken =
      await this.tcrComplianceService.retrieveCampaignVerifyToken(
        pin,
        tcrCompliance,
      )

    if (!campaignVerifyToken) {
      throw new BadGatewayException(
        'Campaign verify token could not be retrieved',
      )
    }

    const campaignVerifyBrand =
      await this.tcrComplianceService.submitCampaignVerifyToken(
        tcrCompliance,
        campaignVerifyToken,
      )

    await this.tcrComplianceService.model.update({
      where: { id: tcrCompliance.id },
      data: {
        status: TcrComplianceStatus.pending,
      },
    })

    try {
      await this.analytics.track(
        user.id,
        EVENTS.Outreach.CompliancePinSubmitted,
        { source: 'compliance_flow' },
      )
    } catch (e) {
      // TODO: Alert on this.
      this.logger.error(
        { e },
        `Failed to track compliance PIN submitted event for user ${user.id}`,
      )
    }

    return campaignVerifyBrand
  }

  @Get(':id/status')
  @UseCampaign()
  async getTcrComplianceStatus(
    @Param('id') tcrComplianceId: string,
    @ReqCampaign() campaign: Campaign,
  ) {
    const { peerlyIdentityId } = await this.retrieveTcrCompliance(
      tcrComplianceId,
      campaign,
    )
    return {
      status: !peerlyIdentityId
        ? false
        : await this.tcrComplianceService.checkTcrRegistrationStatus(
            peerlyIdentityId!,
          ),
    }
  }

  @Delete(':id')
  @UseCampaign()
  async deleteTcrCompliance(
    @Param('id') tcrComplianceId: string,
    @ReqCampaign() campaign: Campaign,
  ) {
    const tcrCompliance = await this.retrieveTcrCompliance(
      tcrComplianceId,
      campaign,
    )
    return this.tcrComplianceService.delete(tcrCompliance.id)
  }
}
