import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseInterceptors,
} from '@nestjs/common'
import {
  CancelOutreachResponse,
  CancelOutreachResponseSchema,
  OutreachArchiveRequest,
  OutreachArchiveRequestSchema,
  OutreachArchiveResponse,
  OutreachArchiveResponseSchema,
  OutreachDetail,
  OutreachDetailSchema,
  OutreachReceipt,
  OutreachReceiptSchema,
  SmsOutreachResultsSchema,
  type SmsOutreachResults,
  SocialAssetPlatform,
  SocialDraftRequest,
  SocialDraftRequestSchema,
  SocialDraftResponse,
  SocialDraftResponseSchema,
  SocialGenerateRequest,
  SocialGenerateRequestSchema,
  SocialGenerateResponse,
  SocialGenerateResponseSchema,
  SocialPurpose,
  SocialSaveRequest,
  SocialSaveRequestSchema,
  excludedSocialPlatformsForPurpose,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { PinoLogger } from 'nestjs-pino'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { Campaign, Organization, User } from '../generated/prisma'
import { OutreachService } from './services/outreach.service'
import { OutreachSocialService } from './services/outreachSocial.service'
import {
  OutreachSocialGenerationService,
  WIN_SOCIAL_VOICE,
} from './services/outreachSocialGeneration.service'
import { OutreachComposeContextService } from './services/outreachComposeContext.service'

const candidateName = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

// GET :id lives here rather than on OutreachController so detail reads stay
// outside OutreachNotificationInterceptor — a 404 there fires a CAS failure
// Slack meant for send attempts.
@Controller('outreach')
@UseCampaign()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachSocialController {
  constructor(
    private readonly socialService: OutreachSocialService,
    private readonly outreachService: OutreachService,
    private readonly generationService: OutreachSocialGenerationService,
    private readonly composeContext: OutreachComposeContextService,
    private readonly organizations: OrganizationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachSocialController.name)
  }

  // The office name lives on the org's election-api position (what
  // campaigns/mine surfaces as positionName), not reliably in the details
  // JSON — normalizedOffice is empty for org-era campaigns. Office is
  // prompt enrichment, so an election-api failure degrades to the
  // fallback chain instead of failing the request.
  private async resolveOffice(campaign: Campaign): Promise<string> {
    let positionName: string | null = null
    if (campaign.organizationSlug) {
      try {
        positionName =
          await this.organizations.resolvePositionNameByOrganizationSlug(
            campaign.organizationSlug,
          )
      } catch (err) {
        this.logger.warn({ err }, 'position resolution failed for compose')
      }
    }
    return positionName ?? campaign.details.normalizedOffice ?? ''
  }

  // The client platform list is UI-only; a Nextdoor-excluded purpose on Win
  // (ENG-10989) is rejected here — on BOTH generate and save, since save
  // persists assets without ever calling generate and must never silently
  // accept an excluded pairing straight into outreach history.
  private assertPlatformsAllowed(
    purpose: SocialPurpose,
    platforms: SocialAssetPlatform[],
  ): void {
    const excludedRequested = platforms.filter((platform) =>
      excludedSocialPlatformsForPurpose('win', purpose).includes(platform),
    )
    if (excludedRequested.length > 0) {
      throw new BadRequestException(
        `Platform not available for purpose "${purpose}": ` +
          excludedRequested.join(', '),
      )
    }
  }

  @Post('social/draft')
  @ResponseSchema(SocialDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @Body(new ZodValidationPipe(SocialDraftRequestSchema))
    input: SocialDraftRequest,
  ): Promise<SocialDraftResponse> {
    return {
      draft: await this.generationService.generateDraft(
        input,
        candidateName(user),
        await this.resolveOffice(campaign),
        String(user.id),
        await this.composeContext.buildCampaignContext(campaign),
        WIN_SOCIAL_VOICE,
      ),
    }
  }

  @Post('social/generate')
  @ResponseSchema(SocialGenerateResponseSchema)
  async generate(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @Body(new ZodValidationPipe(SocialGenerateRequestSchema))
    input: SocialGenerateRequest,
  ): Promise<SocialGenerateResponse> {
    this.assertPlatformsAllowed(input.purpose, input.platforms)
    return {
      assets: await this.generationService.generateAssets(
        input,
        candidateName(user),
        await this.resolveOffice(campaign),
        String(user.id),
        await this.composeContext.buildCampaignContext(campaign),
        WIN_SOCIAL_VOICE,
      ),
    }
  }

  @Post('social')
  @ResponseSchema(OutreachDetailSchema)
  save(
    @ReqCampaign() campaign: Campaign,
    @Body(new ZodValidationPipe(SocialSaveRequestSchema))
    input: SocialSaveRequest,
  ): Promise<OutreachDetail> {
    this.assertPlatformsAllowed(
      input.purpose,
      input.assets.map((asset) => asset.platform),
    )
    return this.socialService.saveSocialOutreach(
      { campaignId: campaign.id, organizationSlug: campaign.organizationSlug },
      input,
    )
  }

  @Get(':id')
  @ResponseSchema(OutreachDetailSchema)
  detail(
    @ReqCampaign() campaign: Campaign,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OutreachDetail> {
    return this.socialService.findDetail({ campaignId: campaign.id }, id)
  }

  // Campaign-scoped like finalize: cancel moves the owning campaign's money
  // and vendor job, so the org-level archive posture does not apply.
  @Post(':id/cancel')
  @ResponseSchema(CancelOutreachResponseSchema)
  async cancel(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CancelOutreachResponse> {
    const { outreach, refunded } = await this.outreachService.cancelOutreach(
      id,
      campaign.id,
      { canceledBy: user.email, byAdmin: false },
    )
    // Campaign-scoped cancel only ever matches a Win row (organizationSlug
    // is metadata here, not the scope path), so campaignId is always set.
    return {
      outreach: { ...outreach, campaignId: outreach.campaignId! },
      refunded,
    }
  }

  // Campaign-scoped like cancel: the receipt is the paying campaign's
  // payment record. 404 when the row has no recorded checkout session
  // (free-texts sends never write one).
  @Get(':id/receipt')
  @ResponseSchema(OutreachReceiptSchema)
  receipt(
    @ReqCampaign() campaign: Campaign,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OutreachReceipt> {
    return this.outreachService.getOutreachReceipt(id, campaign.id)
  }

  // Candidate-facing per-campaign text results (the details sheet's
  // Statistics card). Counts only, computed from the per-recipient
  // interaction rows the hourly sweep maintains; reply content never
  // leaves the CRM.
  @Get(':id/results')
  @ResponseSchema(SmsOutreachResultsSchema)
  results(
    @ReqCampaign() campaign: Campaign,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SmsOutreachResults> {
    return this.outreachService.getSmsResults(id, campaign.id)
  }

  // Org-scoped, like the phone-banking list's own DELETE — an outreach row
  // is never re-scoped to a specific campaign, only to the organization that
  // owns it. continueIfNotFound overrides the class-level @UseCampaign(),
  // which would otherwise 404 a campaign-less (Serve) org before the
  // organization guard runs.
  @Patch(':id/archive')
  @UseCampaign({ continueIfNotFound: true })
  @UseOrganization()
  @ResponseSchema(OutreachArchiveResponseSchema)
  archive(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(OutreachArchiveRequestSchema))
    input: OutreachArchiveRequest,
  ): Promise<OutreachArchiveResponse> {
    return this.outreachService.setArchived(
      id,
      organization.slug,
      input.archived,
    )
  }
}
