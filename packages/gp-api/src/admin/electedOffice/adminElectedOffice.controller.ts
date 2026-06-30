import { AnalyticsService } from '@/analytics/analytics.service'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import { BallotReadyService } from '@/elections/services/ballotReady.service'
import { selectPreferredOfficeHolder } from '@/elections/util/ballotReady.util'
import { ElectionsService } from '@/elections/services/elections.service'
import { APP_ROOT } from '@/shared/util/appEnvironment.util'
import { parseIsoDateAsUTC, toDateOnlyString } from '@/shared/util/date.util'
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
  CreateMagicLinkDto,
  MAGIC_LINK_NAME_REQUIRED_ERROR,
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
    const { email, personId } = body
    // Trim before validating so a name of only whitespace is treated as blank.
    const firstName = body.firstName.trim()
    const lastName = body.lastName.trim()
    if (!firstName || !lastName) {
      throw new BadRequestException(MAGIC_LINK_NAME_REQUIRED_ERROR)
    }

    const { user, token } = await this.usersService.provisionMagicLinkUser({
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

    this.logger.info(
      {
        userId: user.id,
        hasPersonId: Boolean(personId),
        prefilledElectedOfficeId: prefill?.electedOfficeId,
      },
      'Created EO magic link',
    )

    // "Link sent" funnel event, keyed to the provisioned user + email (the EO
    // may not exist yet). Best-effort — never fail link creation on analytics.
    await this.analytics
      .track(user.id, EVENTS.Onboarding.MagicLinkSent, {
        email,
        type: 'serve',
        prefilledElectedOfficeId: prefill?.electedOfficeId,
        ballotReadyPositionId: prefill?.ballotReadyPositionId,
      })
      .catch((err: unknown) => {
        this.logger.warn({ err }, 'Failed to track magic-link-sent event')
      })

    // Return only the ticketed URL — the raw Clerk sign-in token is already
    // embedded in `url` as __clerk_ticket, and no caller reads a separate
    // `token`. Omitting it keeps the credential out of extra logs/proxies.
    return { url, userId: user.id, prefill }
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
