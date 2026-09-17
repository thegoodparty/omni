import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common'
import {
  excludedSocialPlatformsForPurpose,
  OutreachDetail,
  OutreachDetailSchema,
  ServeSocialDraftRequest,
  ServeSocialDraftRequestSchema,
  ServeSocialGenerateRequest,
  ServeSocialGenerateRequestSchema,
  ServeSocialPurpose,
  ServeSocialSaveRequest,
  ServeSocialSaveRequestSchema,
  SocialAssetPlatform,
  SocialDraftResponse,
  SocialDraftResponseSchema,
  SocialGenerateResponse,
  SocialGenerateResponseSchema,
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
import { OutreachService } from './services/outreach.service'
import { OutreachSocialService } from './services/outreachSocial.service'
import {
  OutreachSocialGenerationService,
  SERVE_SOCIAL_VOICE,
} from './services/outreachSocialGeneration.service'
import { OutreachServeComposeContextService } from './services/outreachServeComposeContext.service'

const electedOfficialName = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

// Serve counterpart to OutreachSocialController: org-scoped compose +
// save/list/detail for an elected-office org, never a campaign. @UseElectedOffice
// is the server-side mirror of the webapp's serveAccess() — the client's chosen
// surface is never trusted, so every route here re-derives it from the org's
// own ElectedOffice row (also the ownership check, via the shared guard).
@Controller('outreach/serve')
@UseElectedOffice()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachServeSocialController {
  constructor(
    private readonly socialService: OutreachSocialService,
    private readonly outreachService: OutreachService,
    private readonly generationService: OutreachSocialGenerationService,
    private readonly profileContext: OutreachServeComposeContextService,
    private readonly organizations: OrganizationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachServeSocialController.name)
  }

  // Office name + place are prompt enrichment only, same as the Win draft
  // route — an election-api failure must not fail the draft. The Public
  // Profile lookup is a local DB read (never campaign tables — the serve/win
  // isolation invariant), so it runs outside this try/catch and propagates a
  // real failure instead of degrading silently.
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
      this.logger.warn(
        { err },
        'office/place resolution failed for serve compose',
      )
    }
    context.push(
      ...(await this.profileContext.buildProfileContext(electedOffice.userId)),
    )
    return { office, context }
  }

  // Mirrors the Win gate (ENG-10989): the client platform list is UI-only.
  // Serve's exclusion matrix is empty today, so this never rejects a real
  // Serve request on generate OR save — it only guards against drift if a
  // future Serve purpose ever gains one.
  private assertPlatformsAllowed(
    purpose: ServeSocialPurpose,
    platforms: SocialAssetPlatform[],
  ): void {
    const excludedRequested = platforms.filter((platform) =>
      excludedSocialPlatformsForPurpose('serve', purpose).includes(platform),
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
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(ServeSocialDraftRequestSchema))
    input: ServeSocialDraftRequest,
  ): Promise<SocialDraftResponse> {
    const { office, context } = await this.buildServeContext(electedOffice)
    return {
      draft: await this.generationService.generateDraft(
        input,
        electedOfficialName(user),
        office,
        String(user.id),
        context,
        SERVE_SOCIAL_VOICE,
      ),
    }
  }

  @Post('social/generate')
  @ResponseSchema(SocialGenerateResponseSchema)
  async generate(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(ServeSocialGenerateRequestSchema))
    input: ServeSocialGenerateRequest,
  ): Promise<SocialGenerateResponse> {
    this.assertPlatformsAllowed(input.purpose, input.platforms)
    const { office, context } = await this.buildServeContext(electedOffice)
    return {
      assets: await this.generationService.generateAssets(
        input,
        electedOfficialName(user),
        office,
        String(user.id),
        context,
        SERVE_SOCIAL_VOICE,
      ),
    }
  }

  @Post('social')
  @ResponseSchema(OutreachDetailSchema)
  save(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(ServeSocialSaveRequestSchema))
    input: ServeSocialSaveRequest,
  ): Promise<OutreachDetail> {
    this.assertPlatformsAllowed(
      input.purpose,
      input.assets.map((asset) => asset.platform),
    )
    return this.socialService.saveSocialOutreach(
      { campaignId: null, organizationSlug: electedOffice.organizationSlug },
      input,
    )
  }

  @Get()
  findAll(@ReqElectedOffice() electedOffice: ElectedOffice) {
    return this.outreachService.findByOrganizationSlug(
      electedOffice.organizationSlug,
    )
  }

  @Get(':id')
  @ResponseSchema(OutreachDetailSchema)
  detail(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OutreachDetail> {
    return this.socialService.findDetail(
      { organizationSlug: electedOffice.organizationSlug, campaignId: null },
      id,
    )
  }
}
