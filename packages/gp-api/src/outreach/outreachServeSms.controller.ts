import { Body, Controller, Post, UseInterceptors } from '@nestjs/common'
import {
  ServeSmsCreateRequest,
  ServeSmsCreateRequestSchema,
  ServeSmsCreateResponse,
  ServeSmsCreateResponseSchema,
  ServeSmsDraftRequest,
  ServeSmsDraftRequestSchema,
  ServeSmsDraftResponse,
  ServeSmsDraftResponseSchema,
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
import { OutreachSmsGenerationService } from './services/outreachSmsGeneration.service'
import { OutreachServeComposeContextService } from './services/outreachServeComposeContext.service'
import { OutreachServeSmsCreateService } from './services/outreachServeSmsCreate.service'
import { SERVE_SMS_VOICE } from './util/serveSmsVoice.util'

const electedOfficialName = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

// Serve counterpart to OutreachSmsController: org-scoped, stateless
// draft/improve for the body of one text to constituents.
// @UseElectedOffice is the server-side mirror of the webapp's serveAccess()
// — the client's chosen surface is never trusted, so ownership comes from
// the org's own ElectedOffice row (the guard's 404). Deliberately never
// touches CampaignsService, campaign.details or OutreachComposeContextService:
// an elected official has no campaign row to ground a draft in, and the
// serve/win isolation invariant says this path must not read one.
@Controller('outreach/serve')
@UseElectedOffice()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachServeSmsController {
  constructor(
    private readonly generationService: OutreachSmsGenerationService,
    private readonly profileContext: OutreachServeComposeContextService,
    private readonly organizations: OrganizationsService,
    private readonly createService: OutreachServeSmsCreateService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachServeSmsController.name)
  }

  // Office name + place are prompt enrichment only, same as
  // outreachServePhoneBanking.controller's buildServeContext — an
  // election-api failure must not fail the draft. The Public Profile lookup
  // is a local DB read (never campaign tables), so it runs outside this
  // try/catch and propagates a real failure instead of degrading silently.
  // Duplicated from the two sibling serve controllers rather than extracted:
  // hoisting it would mean editing files this build does not own.
  private async buildServeContext(
    electedOffice: ElectedOffice,
  ): Promise<{ office: string; context: string[] }> {
    let office = ''
    const context: string[] = []
    try {
      const [positionName, district] = await Promise.all([
        this.organizations.resolvePositionNameByOrganizationSlug(
          electedOffice.organizationSlug,
        ),
        this.organizations.getDistrictForOrgSlug(
          electedOffice.organizationSlug,
        ),
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
      this.logger.warn({ err }, 'office/place resolution failed for serve SMS')
    }
    context.push(
      ...(await this.profileContext.buildProfileContext(electedOffice.userId)),
    )
    return { office, context }
  }

  @Post('sms/draft')
  @ResponseSchema(ServeSmsDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(ServeSmsDraftRequestSchema))
    input: ServeSmsDraftRequest,
  ): Promise<ServeSmsDraftResponse> {
    const { office, context } = await this.buildServeContext(electedOffice)
    return {
      draft: await this.generationService.generateDraftWithVoice(
        input,
        electedOfficialName(user),
        office,
        String(user.id),
        context,
        SERVE_SMS_VOICE,
      ),
    }
  }

  // Draft-first create. The row exists BEFORE checkout because the composed
  // message can reach SMS_COMPOSED_MAX_LENGTH (1000) and a Stripe metadata
  // value caps at 500, so the poll pattern of carrying content through
  // checkout metadata cannot work here — checkout carries two ids instead.
  //
  // No matching PATCH: a draft is immutable while pending_payment, so
  // re-entering the flow creates a fresh draft. That is what keeps the
  // priced count and the row the purchase handler re-reads the same thing.
  @Post('sms')
  @ResponseSchema(ServeSmsCreateResponseSchema)
  create(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(ServeSmsCreateRequestSchema))
    input: ServeSmsCreateRequest,
  ): Promise<ServeSmsCreateResponse> {
    // The org comes from the ElectedOffice row the guard resolved, never from
    // the body — the same posture every route on this controller takes.
    return this.createService.createDraft(electedOffice.organizationSlug, input)
  }
}
