import { AnalyticsService } from '@/analytics/analytics.service'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { MagicLinkService } from '@/magicLink/magicLink.service'
import {
  MagicLinkDeliveryService,
  SMS_NO_ACTIVE_LINK_ERROR,
} from '@/magicLink/magicLinkDelivery.service'
import { computeMagicLinkStatus } from '@/magicLink/util/magicLinkStatus.util'
import { APP_ROOT } from '@/shared/util/appEnvironment.util'
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
import { MagicLinkKind } from '../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  CAMPAIGN_MAGIC_LINK_NAME_REQUIRED_ERROR,
  CreateCampaignMagicLinkDto,
  GetCampaignMagicLinkDto,
  SendCampaignMagicLinkSmsDto,
} from './schemas/campaignMagicLink.schema'

// Lives on its own controller (not AdminCampaignsController) because that
// controller is locked to UserRole.admin via the global RolesGuard, which would
// reject the HubSpot M2M token. This mirrors AdminElectedOfficeController:
// AdminOrM2MGuard + no @Roles so the sales tool's M2M bearer is accepted.
@Controller('admin/campaign')
@UsePipes(ZodValidationPipe)
@UseGuards(AdminOrM2MGuard)
export class AdminCampaignMagicLinkController {
  constructor(
    private readonly usersService: UsersService,
    private readonly analytics: AnalyticsService,
    private readonly magicLink: MagicLinkService,
    private readonly magicLinkDelivery: MagicLinkDeliveryService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminCampaignMagicLinkController.name)
  }

  /**
   * Sales-triggered (via HubSpot App Card or gp-admin) endpoint that provisions
   * a passwordless candidate lead, mints a single-use sign-in token, and returns
   * the redemption URL. Unlike the elected-office variant, it deliberately does
   * NOT create an ElectedOffice — a lead with no ElectedOffice and no Campaign
   * is routed by the webapp into the candidate ("Win") onboarding flow
   * (/onboarding/office-selection), where they create their campaign.
   */
  @Post('magic-link')
  @HttpCode(HttpStatus.OK)
  async createMagicLink(@Body() body: CreateCampaignMagicLinkDto) {
    const { email, phone, smsConsent, consentSource } = body
    // Trim before validating so a name of only whitespace is treated as blank.
    const firstName = body.firstName.trim()
    const lastName = body.lastName.trim()
    if (!firstName || !lastName) {
      throw new BadRequestException(CAMPAIGN_MAGIC_LINK_NAME_REQUIRED_ERROR)
    }

    const { user, token, expiresAt } =
      await this.usersService.provisionMagicLinkUser({
        email,
        firstName,
        lastName,
      })

    const url = `${APP_ROOT}/win/welcome?__clerk_ticket=${encodeURIComponent(
      token,
    )}`

    // Persist the link's lifecycle (source of truth) and mirror "sent" onto the
    // HubSpot contact (win_* property set) so the Win sales card shows
    // persistent state. Best-effort — never fail link creation on state
    // tracking.
    await this.magicLink
      .recordSent({
        userId: user.id,
        email,
        url,
        expiresAt,
        kind: MagicLinkKind.WIN,
      })
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
      { userId: user.id, smsSent: delivery?.smsSent },
      'Created candidate magic link',
    )

    // "Link sent" funnel event, keyed to the provisioned user + email (the
    // campaign does not exist yet). Best-effort — never fail link creation on
    // analytics.
    await this.analytics
      .track(user.id, EVENTS.WinOnboarding.MagicLinkSent, { email })
      .catch((err: unknown) => {
        this.logger.warn({ err }, 'Failed to track magic-link-sent event')
      })

    // Return only the ticketed URL — the raw Clerk sign-in token is already
    // embedded in `url` as __clerk_ticket, and no caller reads a separate
    // `token`. Omitting it keeps the credential out of extra logs/proxies.
    return { url, userId: user.id, ...delivery }
  }

  /**
   * Texts the lead's *current* active link, for when the rep emailed it and the
   * lead says it never arrived. Deliberately does not mint a new link: doing so
   * would rotate the slug and kill the link already sitting in their inbox.
   */
  @Post('magic-link/sms')
  @HttpCode(HttpStatus.OK)
  async sendMagicLinkSms(@Body() body: SendCampaignMagicLinkSmsDto) {
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
   * On-demand lookup of a candidate lead's current redemption URL for the Win
   * sales card's "copy link" action. The URL is intentionally NOT mirrored to
   * HubSpot (it carries a live sign-in ticket), so the card fetches it here
   * through the serverless function (M2M). Only returns the URL while the link
   * is still redeemable (`sent`); a redeemed/expired/completed link returns
   * `url: null` so a consumed or dead token is never handed back out.
   */
  @Get('magic-link')
  @HttpCode(HttpStatus.OK)
  async getMagicLink(@Query() query: GetCampaignMagicLinkDto) {
    const link = await this.magicLink.getByEmail(query.email)
    if (!link) {
      return { url: null, status: null }
    }
    const status = computeMagicLinkStatus(link)
    return { url: status === 'sent' ? link.url : null, status }
  }
}
