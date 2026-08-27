import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseInterceptors,
} from '@nestjs/common'
import {
  RobocallComplianceRequest,
  RobocallComplianceRequestSchema,
  RobocallComplianceVerdict,
  RobocallComplianceVerdictSchema,
  RobocallDraftCreateRequest,
  RobocallDraftCreateRequestSchema,
  RobocallDraftCreateResponse,
  RobocallDraftCreateResponseSchema,
  RobocallNumberResponse,
  RobocallNumberResponseSchema,
  RobocallScriptDraftRequest,
  RobocallScriptDraftRequestSchema,
  RobocallScriptDraftResponse,
  RobocallScriptDraftResponseSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { PinoLogger } from 'nestjs-pino'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { CallhubNumbersService } from '@/vendors/callhub/services/callhubNumbers.service'
import { Campaign, Organization, User } from '../generated/prisma'
import { OutreachRobocallGenerationService } from './services/outreachRobocallGeneration.service'
import { OutreachRobocallService } from './services/outreachRobocall.service'
import { RobocallComplianceService } from './services/robocallCompliance.service'
import { OutreachComposeContextService } from './services/outreachComposeContext.service'

const candidateName = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

// Robocall endpoints. The compose surface (script draft, number rental,
// compliance) is stateless — nothing persists there. `POST robocall` is the
// one write: it saves the pending_payment draft (spine + satellite) the
// hold/settlement slices act on.
@Controller('outreach')
@UseCampaign()
@UseOrganization()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachRobocallController {
  constructor(
    private readonly generationService: OutreachRobocallGenerationService,
    private readonly robocallService: OutreachRobocallService,
    private readonly compliance: RobocallComplianceService,
    private readonly composeContext: OutreachComposeContextService,
    private readonly organizations: OrganizationsService,
    private readonly contacts: ContactsService,
    private readonly callhubNumbers: CallhubNumbersService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachRobocallController.name)
  }

  // Office is prompt/verification enrichment: an election-api failure degrades
  // to the campaign's normalized office rather than failing the request.
  private async resolveOffice(campaign: Campaign): Promise<string> {
    const fallback = campaign.details.normalizedOffice ?? ''
    if (!campaign.organizationSlug) return fallback
    try {
      const positionName =
        await this.organizations.resolvePositionNameByOrganizationSlug(
          campaign.organizationSlug,
        )
      return positionName ?? fallback
    } catch (err) {
      this.logger.warn({ err }, 'position resolution failed')
      return fallback
    }
  }

  // Rents a fresh CallHub caller-ID number for this robocall. The candidate
  // reads it aloud as the callback number, so it must exist before the script
  // is drafted with its disclosure. A number is rented per robocall (numbers
  // get spam-flagged); the account auto-un-rents idle ones.
  @Post('robocall/number')
  @ResponseSchema(RobocallNumberResponseSchema)
  async rentNumber(
    @ReqOrganization() organization: Organization,
  ): Promise<RobocallNumberResponse> {
    await this.contacts.assertProAccess(organization)
    const rented = await this.callhubNumbers.rentNumber({ countryIso: 'US' })
    return { phoneNumber: rented.phone_number, region: rented.region }
  }

  @Post('robocall/draft')
  @ResponseSchema(RobocallScriptDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(RobocallScriptDraftRequestSchema))
    input: RobocallScriptDraftRequest,
  ): Promise<RobocallScriptDraftResponse> {
    await this.contacts.assertProAccess(organization)

    return {
      draft: await this.generationService.generateDraft(
        input,
        candidateName(user),
        await this.resolveOffice(campaign),
        String(user.id),
        await this.composeContext.buildCampaignContext(campaign),
      ),
    }
  }

  // Persists the robocall as a pending_payment draft BEFORE payment
  // (draft-first, mirrors p2p): the returned outreachId is the anchor the
  // hold/settlement slices act on. The audioKey is client-held, so confirm it
  // belongs to THIS campaign first. The billable count and amount are derived
  // server-side from voterFileFilterId — never trusting a client count — and
  // returned so the pay step shows the estimate it will authorize.
  @Post('robocall')
  @ResponseSchema(RobocallDraftCreateResponseSchema)
  async createDraft(
    @ReqCampaign() campaign: Campaign,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(RobocallDraftCreateRequestSchema))
    input: RobocallDraftCreateRequest,
  ): Promise<RobocallDraftCreateResponse> {
    await this.contacts.assertProAccess(organization)

    if (!input.audioKey.startsWith(`robocall/${campaign.id}/`)) {
      throw new BadRequestException('Audio does not belong to this campaign')
    }

    return this.robocallService.createDraft(campaign, organization, input)
  }

  // Fail-closed compliance gate for the recorded audio: transcribe and verify
  // the candidate self-ID, organization, and callback number are spoken. The
  // audio key is client-held, so confirm it belongs to THIS campaign first, so
  // a caller can't check another campaign's recording.
  @Post('robocall/compliance')
  @ResponseSchema(RobocallComplianceVerdictSchema)
  async checkCompliance(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(RobocallComplianceRequestSchema))
    input: RobocallComplianceRequest,
  ): Promise<RobocallComplianceVerdict> {
    await this.contacts.assertProAccess(organization)

    if (!input.audioKey.startsWith(`robocall/${campaign.id}/`)) {
      throw new BadRequestException('Audio does not belong to this campaign')
    }

    const name = candidateName(user)
    // Without a name the self-ID check can never pass and the audio can't say
    // it either — fail fast with a fixable error, not a misleading verdict the
    // user is stuck behind.
    if (!name) {
      throw new BadRequestException(
        'Add your name to your campaign profile before recording a robocall.',
      )
    }
    const office = await this.resolveOffice(campaign)
    const organizationName = office ? `${name} for ${office}` : name

    return this.compliance.checkRecording({
      audioKey: input.audioKey,
      contentType: input.contentType,
      candidateName: name,
      organizationName,
      userId: String(user.id),
    })
  }
}
