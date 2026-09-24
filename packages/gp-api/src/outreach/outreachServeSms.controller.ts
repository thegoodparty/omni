import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common'
import {
  ServeSmsCreateRequest,
  ServeSmsCreateRequestSchema,
  ServeSmsCreateResponse,
  ServeSmsCreateResponseSchema,
  ServeSmsDraftRequest,
  ServeSmsDraftRequestSchema,
  ServeSmsDraftResponse,
  ServeSmsDraftResponseSchema,
  SMS_OUTREACH_REPLIES_DEFAULT_LIMIT,
  SMS_OUTREACH_REPLIES_MAX_LIMIT,
  SmsOutreachReplies,
  SmsOutreachRepliesSchema,
  SmsOutreachResults,
  SmsOutreachResultsSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { PinoLogger } from 'nestjs-pino'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ElectedOffice, User } from '../generated/prisma'
import { OutreachService } from './services/outreach.service'
import { OutreachSmsGenerationService } from './services/outreachSmsGeneration.service'
import { OutreachSmsRepliesService } from './services/outreachSmsReplies.service'
import { OutreachServeComposeContextService } from './services/outreachServeComposeContext.service'
import { OutreachServeSmsCreateService } from './services/outreachServeSmsCreate.service'
import { SERVE_SMS_VOICE } from './util/serveSmsVoice.util'

const electedOfficialName = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

// Hand-parsed rather than a Zod query DTO: two optional integers with a
// clamp is smaller than the pipe it would take to reject them, and a reply
// list has nothing to gain from 400ing a nonsense page size when the honest
// answer is the first page.
const clampLimit = (raw?: string): number => {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return SMS_OUTREACH_REPLIES_DEFAULT_LIMIT
  }
  return Math.min(parsed, SMS_OUTREACH_REPLIES_MAX_LIMIT)
}

const clampOffset = (raw?: string): number => {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

// The whole Serve SMS feature ships behind one flag. The two WRITE routes
// here are gated because between them they are the only way into the flow:
// compose and create. The delivery service, the reply ingest, the purchase
// handler and the two results readers at the bottom of this file are
// deliberately NOT gated — none is reachable without an `Outreach` row, and
// the create route below is the only thing that writes one, so gating the
// writer makes the rest inert. Same reasoning `win-team-accounts` records
// for gating only its create route (outreachAssignment.controller.ts).
//
// This gates ROLLOUT, not authorization. @UseElectedOffice() is the real
// access check on every route here and stays that way whatever the flag says.
const SERVE_SMS_FLAG = 'serve-sms-outreach'

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
    private readonly outreachService: OutreachService,
    private readonly repliesService: OutreachSmsRepliesService,
    private readonly features: FeaturesService,
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

  // 404 rather than 403 when the flag is off: a surface the user has not been
  // rolled out to should not advertise that it exists.
  private async assertFeatureEnabled(user: User): Promise<void> {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: SERVE_SMS_FLAG,
    })
    if (!enabled) {
      throw new NotFoundException()
    }
  }

  @Post('sms/draft')
  @ResponseSchema(ServeSmsDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(ServeSmsDraftRequestSchema))
    input: ServeSmsDraftRequest,
  ): Promise<ServeSmsDraftResponse> {
    await this.assertFeatureEnabled(user)
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
  async create(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(ServeSmsCreateRequestSchema))
    input: ServeSmsCreateRequest,
  ): Promise<ServeSmsCreateResponse> {
    await this.assertFeatureEnabled(user)
    // The org comes from the ElectedOffice row the guard resolved, never from
    // the body — the same posture every route on this controller takes.
    return this.createService.createDraft(electedOffice.organizationSlug, input)
  }

  // The Statistics card, org-scoped. Deliberately NOT behind
  // SERVE_SMS_FLAG (see the note above it): a results read is unreachable
  // without an Outreach row, and only the flag-gated create writes one.
  //
  // `campaignId: null` is load-bearing, not decoration — a Win row carries
  // an organizationSlug too, so an org holding both a Campaign and an
  // ElectedOffice would otherwise read its Win results here (ENG-10976).
  // The counts come from ContactInteractionText, which the shared ingest
  // writes for either product, so there is no Serve-specific arithmetic.
  @Get(':id/results')
  @ResponseSchema(SmsOutreachResultsSchema)
  results(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SmsOutreachResults> {
    return this.outreachService.getSmsResults(id, {
      organizationSlug: electedOffice.organizationSlug,
      campaignId: null,
    })
  }

  // The read-only reply list. Same scope and the same ungated reasoning as
  // the results read above. `limit`/`offset` rather than a page number
  // because the client's only two states are the design's first ten and
  // "Show all {n} responses".
  @Get(':id/replies')
  @ResponseSchema(SmsOutreachRepliesSchema)
  replies(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<SmsOutreachReplies> {
    return this.repliesService.listReplies(
      id,
      {
        organizationSlug: electedOffice.organizationSlug,
        campaignId: null,
      },
      {
        limit: clampLimit(limit),
        offset: clampOffset(offset),
      },
    )
  }
}
