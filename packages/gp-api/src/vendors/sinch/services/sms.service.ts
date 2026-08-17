import { Injectable } from '@nestjs/common'
import { parsePhoneNumberWithError } from 'libphonenumber-js'
import { PinoLogger } from 'nestjs-pino'
import { SinchConfig } from '../config/sinchConfig'
import { SendSmsInput, SendSmsResult } from '../sinch.types'
import { SinchTokenService } from './sinchToken.service'

// Sinch queues and retries transient failures itself, so we only retry the
// classes where an immediate resend can plausibly succeed: rate limiting and
// server-side faults. A 4xx (bad number, unregistered sender) will fail
// identically on every attempt.
const MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 250

const isRetryable = (status: number) => status === 429 || status >= 500

/**
 * Pulls the message id out of Sinch's response without trusting its shape. A
 * missing id is not an error — the message is already accepted at this point, we
 * just lose the tracing handle.
 */
function readMessageId(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'message_id' in payload) {
    const id = payload.message_id
    if (typeof id === 'string') return id
  }
  return null
}

@Injectable()
export class SmsService {
  private readonly config = new SinchConfig()

  constructor(
    private readonly token: SinchTokenService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SmsService.name)
  }

  get isConfigured(): boolean {
    return this.config.isConfigured
  }

  /**
   * Sends a single SMS over the Conversation API's SMS channel. Never throws —
   * returns a result the caller can surface to the rep, because every current
   * caller treats delivery as best-effort and still hands back a copyable link.
   */
  async sendSms({ to, body }: SendSmsInput): Promise<SendSmsResult> {
    if (!this.config.isConfigured) {
      return {
        sent: false,
        error:
          'SMS is not configured (SINCH_PROJECT_ID, SINCH_KEY_ID, SINCH_KEY_SECRET, SINCH_APP_ID and SINCH_FROM_NUMBER are required).',
      }
    }

    let normalized: string
    try {
      normalized = parsePhoneNumberWithError(to, 'US').number
    } catch {
      return { sent: false, error: `'${to}' is not a valid phone number.` }
    }

    // Redirect away from the real recipient in non-prod before any network call,
    // so a misconfigured intercept can't leak a message to a lead.
    const recipient = this.config.interceptPhone ?? normalized
    if (this.config.interceptPhone) {
      this.logger.info(
        { intended: normalized },
        'SMS_INTERCEPT_PHONE is set; redirecting message',
      )
    }

    return this.sendWithRetry(recipient, body)
  }

  private async sendWithRetry(
    to: string,
    body: string,
  ): Promise<SendSmsResult> {
    let lastError = 'SMS send failed.'
    let retriedAuth = false

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const token = await this.token.getToken()
        const res = await fetch(this.config.messagesSendUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            app_id: this.config.appId,
            // The app runs in DISPATCH mode, which requires addressing the
            // recipient by channel identity rather than by a stored contact.
            recipient: {
              identified_by: {
                channel_identities: [{ channel: 'SMS', identity: to }],
              },
            },
            message: { text_message: { text: body } },
            channel_priority_order: ['SMS'],
            channel_properties: {
              SMS_SENDER: this.config.fromNumber,
              // We already assert a single GSM-7 segment when composing the
              // body; this makes Sinch reject an overflow rather than silently
              // billing us for two parts.
              SMS_MAX_NUMBER_OF_MESSAGE_PARTS: '1',
            },
          }),
          signal: AbortSignal.timeout(this.config.httpTimeoutMs),
        })

        if (res.ok) {
          const messageId = readMessageId(await res.json())
          // Sinch's error vocabulary is thinner than Twilio's, so the message id
          // is the only handle for tracing a message a rep reports as missing.
          this.logger.info({ messageId }, 'Sent magic-link SMS via Sinch')
          return { sent: true, messageId }
        }

        const text = await res.text()
        lastError = `Sinch returned ${res.status}: ${text}`

        if (res.status === 401 && !retriedAuth) {
          // The one 4xx a retry can fix: the token was revoked or expired ahead
          // of its advertised TTL. Worth exactly one attempt, since a wrong
          // access key answers 401 forever.
          retriedAuth = true
          this.token.invalidate()
        } else if (!isRetryable(res.status)) {
          this.logger.error({ status: res.status, text }, 'Sinch rejected send')
          return { sent: false, error: lastError }
        }
      } catch (e) {
        lastError = `Failed to reach Sinch: ${e instanceof Error ? e.message : String(e)}`
      }

      if (attempt < MAX_ATTEMPTS) {
        this.logger.warn(
          { attempt, lastError },
          'Retrying Sinch send after transient failure',
        )
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)),
        )
      }
    }

    this.logger.error({ lastError }, 'Exhausted Sinch send attempts')
    return { sent: false, error: lastError }
  }
}
