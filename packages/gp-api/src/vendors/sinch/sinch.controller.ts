import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { SinchConfig } from './config/sinchConfig'
import { SmsOptOutService } from './services/smsOptOut.service'
import {
  classifyInboundMessage,
  SINCH_NONCE_HEADER,
  SINCH_SIGNATURE_HEADER,
  SINCH_TIMESTAMP_HEADER,
  verifySinchSignature,
} from './util/sinchSignature.util'

/**
 * The slice of a Conversation API MESSAGE_INBOUND callback we act on. Parsed
 * rather than asserted because the payload arrives from the network.
 *
 * The channel is pinned to SMS so that adding another Conversation API channel
 * later cannot quietly feed non-SMS identities into the opt-out table. Payloads
 * from the Smart Conversations redaction trigger carry `message_redaction`
 * instead of `message` and so fail this parse, which is what we want: we act on
 * the unredacted trigger only.
 */
const InboundCallbackSchema = z.object({
  message: z.object({
    channel_identity: z.object({
      channel: z.literal('SMS'),
      identity: z.string().min(1),
    }),
    contact_message: z
      .object({
        text_message: z.object({ text: z.string() }).optional(),
      })
      .optional(),
  }),
})

@Controller('sinch')
export class SinchController {
  private readonly config = new SinchConfig()

  constructor(
    private readonly optOut: SmsOptOutService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SinchController.name)
  }

  /**
   * MESSAGE_INBOUND callback, used to honor STOP. Public because Sinch calls it
   * without a session, and gated on the HMAC signature instead — modelled on the
   * Stripe webhook, which is public plus signature verification rather than an
   * open endpoint.
   *
   * Always answers 200 once authenticated: a non-2xx makes Sinch retry, and
   * nothing we do here becomes correct on a second delivery.
   */
  @Post('inbound')
  @PublicAccess()
  @HttpCode(HttpStatus.OK)
  async handleInbound(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string>,
  ) {
    const secret = this.config.webhookSecret
    if (!secret) {
      // Fail closed. Sinch signs callbacks with the secret set when the webhook
      // was registered, so an unset secret means we cannot tell a real STOP from
      // a forged one — and a forged one can suppress a lead's texts.
      this.logger.error(
        'SINCH_WEBHOOK_SECRET is not set; refusing inbound SMS callback',
      )
      throw new UnauthorizedException(
        'Inbound SMS callbacks are not configured',
      )
    }

    // Verify over the raw bytes: parsing and re-serializing changes the digest.
    const rawBody = req.rawBody?.toString('utf8') ?? ''
    const verified = verifySinchSignature({
      rawBody,
      signature: headers[SINCH_SIGNATURE_HEADER],
      nonce: headers[SINCH_NONCE_HEADER],
      timestamp: headers[SINCH_TIMESTAMP_HEADER],
      secret,
    })
    if (!verified) {
      this.logger.warn('Rejected inbound SMS callback with a bad signature')
      throw new UnauthorizedException('Invalid signature')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      this.logger.warn('Inbound SMS callback body was not valid JSON')
      return { ok: true }
    }

    const inbound = InboundCallbackSchema.safeParse(parsed)
    if (!inbound.success) {
      this.logger.info('Ignoring inbound callback that is not an SMS message')
      return { ok: true }
    }

    const { channel_identity, contact_message } = inbound.data.message
    const intent = classifyInboundMessage(contact_message?.text_message?.text)
    if (intent === 'other') {
      // We do not run a two-way conversation on this number, so anything that is
      // not an opt-out keyword is only worth counting.
      this.logger.info('Ignoring inbound SMS with no opt-out keyword')
      return { ok: true }
    }

    await this.optOut.setOptedOut(
      channel_identity.identity,
      intent === 'opt_out',
    )
    return { ok: true }
  }
}
