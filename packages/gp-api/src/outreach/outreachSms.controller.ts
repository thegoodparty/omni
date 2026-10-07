import { Body, Controller, Post, UseInterceptors } from '@nestjs/common'
import {
  SmsDraftRequest,
  SmsDraftRequestSchema,
  SmsDraftResponse,
  SmsDraftResponseSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { PinoLogger } from 'nestjs-pino'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { User } from '../generated/prisma'
import { CampaignWith } from '@/campaigns/campaigns.types'
import {
  OutreachSmsGenerationService,
  type SmsImproveProtection,
} from './services/outreachSmsGeneration.service'
import { OutreachComposeContextService } from './services/outreachComposeContext.service'
import { ownerCandidateName } from '@/campaigns/util/ownerCandidateName.util'
import { CampaignTcrComplianceService } from 'src/campaigns/tcrCompliance/services/campaignTcrCompliance.service'

@Controller('outreach')
@UseCampaign({ include: { user: true } })
@UseInterceptors(ZodResponseInterceptor)
export class OutreachSmsController {
  constructor(
    private readonly generationService: OutreachSmsGenerationService,
    private readonly composeContext: OutreachComposeContextService,
    private readonly organizations: OrganizationsService,
    private readonly tcrCompliance: CampaignTcrComplianceService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachSmsController.name)
  }

  @Post('sms/draft')
  @ResponseSchema(SmsDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Body(new ZodValidationPipe(SmsDraftRequestSchema))
    input: SmsDraftRequest,
  ): Promise<SmsDraftResponse> {
    // Same office-resolution posture as the social draft: the position
    // name lives on the org's election-api position; a failure there
    // degrades to the details fallback instead of failing the draft.
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
    // Improve gets the message's locked parts from the same names and
    // committee the scheduling compliance check reads, so what the model is
    // kept away from is exactly what scheduling will enforce.
    const protection = input.currentDraft
      ? await this.improveProtection(campaign)
      : undefined
    return {
      draft: await this.generationService.generateDraft(
        input,
        ownerCandidateName(campaign),
        positionName ?? campaign.details.normalizedOffice ?? '',
        String(user.id),
        [
          ...(campaign.details.website
            ? [`The campaign's website: ${campaign.details.website}`]
            : []),
          ...(await this.composeContext.buildCampaignContext(campaign)),
        ],
        protection,
      ),
    }
  }

  private async improveProtection(
    campaign: CampaignWith<'user'>,
  ): Promise<SmsImproveProtection> {
    const tcr = await this.tcrCompliance.findFirst({
      where: { campaignId: campaign.id },
    })
    return {
      candidateNames: [ownerCandidateName(campaign), tcr?.candidateName].filter(
        (name): name is string => !!name,
      ),
      committeeName: tcr?.committeeName ?? null,
      channel: 'peerly',
      ignoredRules: [],
    }
  }
}
