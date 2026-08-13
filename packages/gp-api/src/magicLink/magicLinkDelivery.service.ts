import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { UsersService } from '../users/services/users.service'
import { SmsService } from '../vendors/sinch/services/sms.service'
import { MagicLinkService } from './magicLink.service'
import {
  buildMagicLinkShortUrl,
  buildMagicLinkSmsBody,
} from './util/magicLinkSms.util'
import { computeMagicLinkStatus } from './util/magicLinkStatus.util'

export type TextLinkResult = {
  smsSent: boolean
  smsError?: string
}

export const SMS_OPTED_OUT_ERROR =
  'This lead has replied STOP to a previous message and cannot be texted.'
export const SMS_CONSENT_REQUIRED_ERROR =
  'SMS consent is required before texting a sign-in link.'
export const SMS_NO_ACTIVE_LINK_ERROR =
  'There is no active sign-in link to text — generate a new one first.'
export const SMS_NO_SLUG_ERROR =
  'This link predates short links, so it cannot be texted. Generate a new one.'

/**
 * Shared SMS delivery for sales-sent magic links, used by both the serve (EO)
 * and win (candidate) admin controllers.
 *
 * Consent is enforced here rather than in the HubSpot card, because a UI-only
 * checkbox is not a control: the endpoints take an M2M token and there are two
 * separate card projects that could drift.
 */
@Injectable()
export class MagicLinkDeliveryService {
  constructor(
    private readonly magicLink: MagicLinkService,
    private readonly users: UsersService,
    private readonly sms: SmsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MagicLinkDeliveryService.name)
  }

  /**
   * Texts the lead's current active link. Used both immediately after minting a
   * link and by the standalone "text it again" endpoint, so it always reads the
   * persisted row rather than taking a URL — that way it can never text a slug
   * that the database does not agree is current.
   *
   * Never throws: every caller treats delivery as best-effort and still returns
   * a copyable link to the rep, so failures come back as `smsError`.
   */
  async textActiveLink(args: {
    userId: number
    phone: string
    smsConsent?: boolean
    consentSource?: string
  }): Promise<TextLinkResult> {
    const { userId, phone } = args

    try {
      const consent = await this.ensureConsent(args)
      if (consent) return consent

      const link = await this.magicLink.getByUserId(userId)
      if (!link || computeMagicLinkStatus(link) !== 'sent') {
        return { smsSent: false, smsError: SMS_NO_ACTIVE_LINK_ERROR }
      }
      if (!link.slug) {
        return { smsSent: false, smsError: SMS_NO_SLUG_ERROR }
      }

      const result = await this.sms.sendSms({
        to: phone,
        body: buildMagicLinkSmsBody(buildMagicLinkShortUrl(link.slug)),
      })

      if (!result.sent) {
        this.logger.warn(
          { userId, err: result.error },
          'Failed to text magic link',
        )
        return { smsSent: false, smsError: result.error }
      }

      // Tracing metadata only — a failure here must not report the text as
      // unsent, because it has already left our hands.
      await this.magicLink
        .recordSmsSent({ userId, phone, messageId: result.messageId })
        .catch((err: unknown) => {
          this.logger.warn({ err, userId }, 'Failed to record SMS delivery')
        })

      return { smsSent: true }
    } catch (err) {
      this.logger.error(
        { err, userId },
        'Unexpected failure texting magic link',
      )
      return { smsSent: false, smsError: 'Failed to send the text message.' }
    }
  }

  /**
   * Hard consent gate. Returns a failure result to hand straight back to the
   * caller, or null when the send may proceed. Records consent on the user the
   * first time a rep asserts it, so it survives the link it was captured for.
   */
  private async ensureConsent(args: {
    userId: number
    smsConsent?: boolean
    consentSource?: string
  }): Promise<TextLinkResult | null> {
    const user = await this.users.findUser({ id: args.userId })
    if (!user) {
      return { smsSent: false, smsError: SMS_CONSENT_REQUIRED_ERROR }
    }

    // An opt-out always wins, including over a rep re-checking the box. Only an
    // inbound START (handled separately) may clear it.
    if (user.smsOptedOutAt) {
      return { smsSent: false, smsError: SMS_OPTED_OUT_ERROR }
    }

    if (user.smsConsentAt) return null

    if (!args.smsConsent) {
      return { smsSent: false, smsError: SMS_CONSENT_REQUIRED_ERROR }
    }

    await this.users.updateUser(
      { id: args.userId },
      {
        smsConsentAt: new Date(),
        smsConsentSource: args.consentSource ?? 'hubspot_card',
      },
    )
    return null
  }
}
