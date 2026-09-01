import { Body, Controller, Post, UseInterceptors } from '@nestjs/common'
import {
  PhoneBankingScriptDraftResponse,
  PhoneBankingScriptDraftResponseSchema,
  ServePhoneBankingScriptDraftRequest,
  ServePhoneBankingScriptDraftRequestSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { PinoLogger } from 'nestjs-pino'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ElectedOffice, User } from '../generated/prisma'
import {
  OutreachPhoneBankingGenerationService,
  SERVE_PHONE_BANKING_VOICE,
} from './services/outreachPhoneBankingGeneration.service'

const electedOfficialName = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

// Serve counterpart to OutreachPhoneBankingController: org-scoped,
// stateless draft/improve for phone-banking call scripts.
// @UseElectedOffice is the server-side mirror of the webapp's
// serveAccess() — the client's chosen surface is never trusted, so
// ownership comes from the org's own ElectedOffice row (the guard's 404).
// Deliberately never touches CampaignsService, campaign.details, or
// buildDateContext — serve purposes carry no voting mechanics.
@Controller('outreach/serve')
@UseElectedOffice()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachServePhoneBankingController {
  constructor(
    private readonly generationService: OutreachPhoneBankingGenerationService,
    private readonly organizations: OrganizationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachServePhoneBankingController.name)
  }

  // Office name + place are prompt enrichment only, same as
  // outreachServeSocial.controller's buildServeContext — an election-api
  // failure must not fail the draft.
  private async buildServeContext(
    organizationSlug: string,
  ): Promise<{ office: string; context: string[] }> {
    let office = ''
    const context: string[] = []
    try {
      const [positionName, district] = await Promise.all([
        this.organizations.resolvePositionNameByOrganizationSlug(
          organizationSlug,
        ),
        this.organizations.getDistrictForOrgSlug(organizationSlug),
      ])
      office = positionName ?? ''
      const city =
        district &&
        OrganizationsService.extractCityFromDistrictName(district.l2Name)
      if (city && district) {
        context.push(
          `Where the elected official serves: ${city}, ${district.state}.`,
        )
      }
    } catch (err) {
      this.logger.warn(
        { err },
        'office/place resolution failed for serve phone-banking compose',
      )
    }
    return { office, context }
  }

  @Post('phone-banking/draft')
  @ResponseSchema(PhoneBankingScriptDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(ServePhoneBankingScriptDraftRequestSchema))
    input: ServePhoneBankingScriptDraftRequest,
  ): Promise<PhoneBankingScriptDraftResponse> {
    const { office, context } = await this.buildServeContext(
      electedOffice.organizationSlug,
    )
    return {
      draft: await this.generationService.generateDraft(
        input,
        electedOfficialName(user),
        office,
        String(user.id),
        context,
        SERVE_PHONE_BANKING_VOICE,
      ),
    }
  }
}
