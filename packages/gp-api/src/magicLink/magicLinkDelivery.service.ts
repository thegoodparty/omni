import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { MagicLinkKind } from '../generated/prisma'
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
export const SMS_PHONE_MISMATCH_ERROR =
  'This link has already been texted to a different number. Generate a new link to send it somewhere else.'
export const SMS_RECORD_FAILED_ERROR =
  'The link was created but could not be saved, so it could not be texted. Copy the link above, or try again.'

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
    kind: MagicLinkKind
    phone: string
    smsConsent?: boolean
    consentSource?: string
  }): Promise<TextLinkResult> {
    const { userId, kind, phone } = args

    try {
      // Checked before the link is read, recorded after. The consent questions
      // are the ones whose answers the rep most needs — "they replied STOP" and
      // "nobody has consented" are about the lead, and end the attempt, whereas
      // a stale link is a thing the rep can fix by minting a new one. Asking
      // them in the other order would answer an opted-out lead with "generate a
      // new one first", which invites exactly the retry loop an opt-out exists
      // to stop.
      const consent = await this.checkConsent(args)
      if (!consent.ok) {
        return { smsSent: false, smsError: consent.error }
      }

      const link = await this.magicLink.getByUserId(userId, kind)
      if (!link || computeMagicLinkStatus(link) !== 'sent') {
        return { smsSent: false, smsError: SMS_NO_ACTIVE_LINK_ERROR }
      }
      if (!link.slug) {
        return { smsSent: false, smsError: SMS_NO_SLUG_ERROR }
      }

      // Only now that a send is certain to be attempted, and before it is:
      // consent has to be on the row BEFORE the first message goes out, never
      // after, or a vendor success plus a failed write leaves a text sent
      // against no record. The narrow window that remains — consent stored,
      // Sinch then refuses — is the honest one, because the rep did assert
      // consent for a real send. What this no longer does is bank consent
      // during a session that never had anything to text, where the row would
      // claim a lead opted in on a link that was expired, missing, or older
      // than short links.
      if (consent.record) {
        await this.recordConsent(args)
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
        .recordSmsSent({ userId, kind, phone, messageId: result.messageId })
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
   * Hard consent gate, read-only. Answers whether a send may proceed and, if
   * so, whether this is the first time a rep has asserted consent for this
   * lead and it therefore still has to be written down.
   *
   * Deciding and writing are separate so the caller can put the write after the
   * link checks without moving the questions, which have to stay ahead of them.
   */
  private async checkConsent(args: {
    userId: number
    smsConsent?: boolean
  }): Promise<{ ok: true; record: boolean } | { ok: false; error: string }> {
    const user = await this.users.findUser({ id: args.userId })
    if (!user) {
      return { ok: false, error: SMS_CONSENT_REQUIRED_ERROR }
    }

    // An opt-out always wins, including over a rep re-checking the box. Only an
    // inbound START (handled separately) may clear it.
    if (user.smsOptedOutAt) {
      return { ok: false, error: SMS_OPTED_OUT_ERROR }
    }

    // Already on the row from an earlier send, so there is nothing to write and
    // consent survives the link it was captured for.
    if (user.smsConsentAt) return { ok: true, record: false }

    if (!args.smsConsent) {
      return { ok: false, error: SMS_CONSENT_REQUIRED_ERROR }
    }

    return { ok: true, record: true }
  }

  /** Stores a first-time consent assertion, so it outlives this send. */
  private async recordConsent(args: {
    userId: number
    consentSource?: string
  }): Promise<void> {
    await this.users.updateUser(
      { id: args.userId },
      {
        smsConsentAt: new Date(),
        smsConsentSource: args.consentSource ?? 'hubspot_card',
      },
    )
  }
}
