import { Body, Controller, Post, UseInterceptors } from '@nestjs/common'
import {
  PhoneBankingScriptDraftRequest,
  PhoneBankingScriptDraftRequestSchema,
  PhoneBankingScriptDraftResponse,
  PhoneBankingScriptDraftResponseSchema,
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
import { Campaign, Organization, User } from '../generated/prisma'
import { OutreachPhoneBankingGenerationService } from './services/outreachPhoneBankingGeneration.service'
import { OutreachComposeContextService } from './services/outreachComposeContext.service'

const candidateName = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

// Stateless, like the social draft endpoint: nothing persists here. The
// create flow holds the draft client-side and freezes it via the (separate)
// POST /v1/phone-banking/lists endpoint.
@Controller('outreach')
@UseCampaign()
@UseOrganization()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachPhoneBankingController {
  constructor(
    private readonly generationService: OutreachPhoneBankingGenerationService,
    private readonly composeContext: OutreachComposeContextService,
    private readonly organizations: OrganizationsService,
    private readonly contacts: ContactsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachPhoneBankingController.name)
  }

  @Post('phone-banking/draft')
  @ResponseSchema(PhoneBankingScriptDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(PhoneBankingScriptDraftRequestSchema))
    input: PhoneBankingScriptDraftRequest,
  ): Promise<PhoneBankingScriptDraftResponse> {
    await this.contacts.assertProAccess(organization)

    // Office is prompt enrichment (see outreachSocial.controller): an
    // election-api failure degrades to the fallback chain instead of
    // failing the draft.
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
        campaign,
        await this.composeContext.buildCampaignContext(campaign),
      ),
    }
  }
}
