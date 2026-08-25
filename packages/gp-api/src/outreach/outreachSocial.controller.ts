import {
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
  SocialDraftRequest,
  SocialDraftRequestSchema,
  SocialDraftResponse,
  SocialDraftResponseSchema,
  SocialGenerateRequest,
  SocialGenerateRequestSchema,
  SocialGenerateResponse,
  SocialGenerateResponseSchema,
  SocialSaveRequest,
  SocialSaveRequestSchema,
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
import { OutreachSocialGenerationService } from './services/outreachSocialGeneration.service'
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

  @Post('social/draft')
  @ResponseSchema(SocialDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @Body(new ZodValidationPipe(SocialDraftRequestSchema))
    input: SocialDraftRequest,
  ): Promise<SocialDraftResponse> {
    // The office name lives on the org's election-api position (what
    // campaigns/mine surfaces as positionName), not reliably in the
    // details JSON — normalizedOffice is empty for org-era campaigns.
    // Office is prompt enrichment, so an election-api failure degrades to
    // the fallback chain instead of failing the draft.
    let positionName: string | null = null
    if (campaign.organizationSlug) {
      try {
        positionName =
          await this.organizations.resolvePositionNameByOrganizationSlug(
            campaign.organizationSlug,
          )
      } catch (err) {
        this.logger.warn({ err }, 'position resolution failed for draft')
      }
    }
    return {
      draft: await this.generationService.generateDraft(
        input,
        candidateName(user),
        positionName ?? campaign.details.normalizedOffice ?? '',
        String(user.id),
        await this.composeContext.buildCampaignContext(campaign),
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
    return {
      assets: await this.generationService.generateAssets(
        input,
        candidateName(user),
        String(user.id),
        await this.composeContext.buildCampaignContext(campaign),
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
    return this.socialService.saveSocialOutreach(campaign, input)
  }

  @Get(':id')
  @ResponseSchema(OutreachDetailSchema)
  detail(
    @ReqCampaign() campaign: Campaign,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OutreachDetail> {
    return this.socialService.findDetail(campaign.id, id)
  }

  // Campaign-scoped like finalize: cancel moves the owning campaign's money
  // and vendor job, so the org-level archive posture does not apply.
  @Post(':id/cancel')
  @ResponseSchema(CancelOutreachResponseSchema)
  async cancel(
    @ReqCampaign() campaign: Campaign,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CancelOutreachResponse> {
    return this.outreachService.cancelOutreach(id, campaign.id)
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
