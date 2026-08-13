import { AnalyticsService } from '@/analytics/analytics.service'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import {
  BallotReadyService,
  selectPreferredOfficeHolder,
} from '@/elections/services/ballotReady.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { MagicLinkService } from '@/magicLink/magicLink.service'
import {
  MagicLinkDeliveryService,
  SMS_NO_ACTIVE_LINK_ERROR,
} from '@/magicLink/magicLinkDelivery.service'
import { computeMagicLinkStatus } from '@/magicLink/util/magicLinkStatus.util'
import { APP_ROOT } from '@/shared/util/appEnvironment.util'
import { parseIsoDateAsUTC, toDateOnlyString } from '@/shared/util/date.util'
import { UsersService } from '@/users/services/users.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  CreateMagicLinkDto,
  GetMagicLinkDto,
  MAGIC_LINK_NAME_REQUIRED_ERROR,
  SendMagicLinkSmsDto,
} from './schemas/magicLink.schema'

type ElectedOfficePrefill = {
  electedOfficeId: string
  ballotReadyPositionId: string | null
  positionName: string | null
  termStartDate: string | null
  termEndDate: string | null
}

@Controller('admin/elected-office')
@UsePipes(ZodValidationPipe)
@UseGuards(AdminOrM2MGuard)
export class AdminElectedOfficeController {
  constructor(
    private readonly usersService: UsersService,
    private readonly electedOfficeService: ElectedOfficeService,
    private readonly ballotReadyService: BallotReadyService,
    private readonly elections: ElectionsService,
    private readonly analytics: AnalyticsService,
    private readonly magicLink: MagicLinkService,
    private readonly magicLinkDelivery: MagicLinkDeliveryService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminElectedOfficeController.name)
  }

  /**
   * Sales-triggered (via HubSpot App Card or gp-admin) endpoint that provisions
   * a passwordless lead, mints a single-use sign-in token, optionally pre-fills
   * an elected office from BallotReady, and returns the redemption URL.
   */
  @Post('magic-link')
  @HttpCode(HttpStatus.OK)
  async createMagicLink(@Body() body: CreateMagicLinkDto) {
    const { email, personId, phone, smsConsent, consentSource } = body
    // Trim before validating so a name of only whitespace is treated as blank.
    const firstName = body.firstName.trim()
    const lastName = body.lastName.trim()
    if (!firstName || !lastName) {
      throw new BadRequestException(MAGIC_LINK_NAME_REQUIRED_ERROR)
    }

    const { user, token, expiresAt } =
      await this.usersService.provisionMagicLinkUser({
        email,
        firstName,
        lastName,
      })

    const prefill = personId
      ? await this.prefillFromBallotReady(user.id, personId)
      : undefined

    // Every EO lead must own an ElectedOffice so post-auth routing recognizes
    // them as an elected official and lands them in serve onboarding (not the
    // candidate/"win" flow) — even when we have no BallotReady data to pre-fill.
    // create() is idempotent per user, so this is a no-op when prefill already
    // created one.
    if (!prefill) {
      await this.electedOfficeService.create({ userId: user.id })
    }

    const url = `${APP_ROOT}/serve/welcome?__clerk_ticket=${encodeURIComponent(
      token,
    )}`

    // Persist the link's lifecycle (source of truth) and mirror "sent" onto the
    // HubSpot contact so the sales card shows persistent state. Best-effort —
    // never fail link creation on state tracking.
    await this.magicLink
      .recordSent({ userId: user.id, email, url, expiresAt })
      .catch((err: unknown) => {
        this.logger.warn({ err }, 'Failed to record magic-link sent state')
      })

    // Text it in the same call when the rep supplied a phone — they clicked one
    // button. Best-effort like the email path: a delivery failure comes back as
    // `smsError` and the rep still has a copyable link.
    const delivery = phone
      ? await this.magicLinkDelivery.textActiveLink({
          userId: user.id,
          phone,
          smsConsent,
          consentSource,
        })
      : undefined

    this.logger.info(
      {
        userId: user.id,
        hasPersonId: Boolean(personId),
        prefilledElectedOfficeId: prefill?.electedOfficeId,
        smsSent: delivery?.smsSent,
      },
      'Created EO magic link',
    )

    // "Link sent" funnel event, keyed to the provisioned user + email (the EO
    // may not exist yet). Best-effort — never fail link creation on analytics.
    await this.analytics
      .track(user.id, EVENTS.Onboarding.MagicLinkSent, {
        email,
        prefilledElectedOfficeId: prefill?.electedOfficeId,
        ballotReadyPositionId: prefill?.ballotReadyPositionId,
      })
      .catch((err: unknown) => {
        this.logger.warn({ err }, 'Failed to track magic-link-sent event')
      })

    // Return only the ticketed URL — the raw Clerk sign-in token is already
    // embedded in `url` as __clerk_ticket, and no caller reads a separate
    // `token`. Omitting it keeps the credential out of extra logs/proxies.
    return { url, userId: user.id, prefill, ...delivery }
  }

  /**
   * Texts the lead's *current* active link, for when the rep emailed it and the
   * lead says it never arrived. Deliberately does not mint a new link: doing so
   * would rotate the slug and kill the link already sitting in their inbox.
   */
  @Post('magic-link/sms')
  @HttpCode(HttpStatus.OK)
  async sendMagicLinkSms(@Body() body: SendMagicLinkSmsDto) {
    const link = await this.magicLink.getByEmail(body.email)
    if (!link) {
      return { smsSent: false, smsError: SMS_NO_ACTIVE_LINK_ERROR }
    }
    return this.magicLinkDelivery.textActiveLink({
      userId: link.userId,
      phone: body.phone,
      smsConsent: body.smsConsent,
      consentSource: body.consentSource,
    })
  }

  /**
   * On-demand lookup of a lead's current redemption URL for the sales card's
   * "copy link" action. The URL is intentionally NOT mirrored to HubSpot (it
   * carries a live sign-in ticket), so the card fetches it here through the
   * serverless function (M2M). Only returns the URL while the link is still
   * redeemable (`sent`); a redeemed/expired/completed link returns `url: null`
   * so a consumed or dead token is never handed back out.
   */
  @Get('magic-link')
  @HttpCode(HttpStatus.OK)
  async getMagicLink(@Query() query: GetMagicLinkDto) {
    const link = await this.magicLink.getByEmail(query.email)
    if (!link) {
      return { url: null, status: null }
    }
    const status = computeMagicLinkStatus(link)
    return { url: status === 'sent' ? link.url : null, status }
  }

  private async prefillFromBallotReady(
    userId: number,
    personId: string,
  ): Promise<ElectedOfficePrefill | undefined> {
    const holders =
      await this.ballotReadyService.fetchPersonOfficeHolders(personId)
    const holder = holders ? selectPreferredOfficeHolder(holders) : null
    if (!holder) return undefined

    const termStartDate = holder.startAt
      ? parseIsoDateAsUTC(holder.startAt)
      : null
    const termEndDate = holder.endAt ? parseIsoDateAsUTC(holder.endAt) : null

    const created = await this.electedOfficeService.create({
      userId,
      termStartDate,
      termEndDate,
      orgData: {
        // Store election-api's internal Position id, not the BallotReady id —
        // consumers (re-election dating, city-slug resolution) key on the
        // internal id. Falls back to the BR id only when election-api lacks
        // the position.
        positionId: holder.position?.id
          ? await this.elections.resolveInternalPositionId(holder.position.id)
          : null,
        customPositionName: holder.position?.name ?? null,
        overrideDistrictId: null,
      },
    })

    return {
      electedOfficeId: created.id,
      ballotReadyPositionId: holder.position?.id ?? null,
      positionName: holder.position?.name ?? null,
      termStartDate: toDateOnlyString(termStartDate) ?? null,
      termEndDate: toDateOnlyString(termEndDate) ?? null,
    }
  }
}
