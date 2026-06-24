import { AnalyticsService } from '@/analytics/analytics.service'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { APP_ROOT } from '@/shared/util/appEnvironment.util'
import { UsersService } from '@/users/services/users.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  CAMPAIGN_MAGIC_LINK_NAME_REQUIRED_ERROR,
  CreateCampaignMagicLinkDto,
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
    const { email } = body
    // Trim before validating so a name of only whitespace is treated as blank.
    const firstName = body.firstName.trim()
    const lastName = body.lastName.trim()
    if (!firstName || !lastName) {
      throw new BadRequestException(CAMPAIGN_MAGIC_LINK_NAME_REQUIRED_ERROR)
    }

    const { user, token } = await this.usersService.provisionMagicLinkUser({
      email,
      firstName,
      lastName,
    })

    const url = `${APP_ROOT}/win/welcome?__clerk_ticket=${encodeURIComponent(
      token,
    )}`

    this.logger.info({ userId: user.id }, 'Created candidate magic link')

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
    return { url, userId: user.id }
  }
}
