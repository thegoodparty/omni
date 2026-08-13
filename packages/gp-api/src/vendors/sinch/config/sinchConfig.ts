const DEFAULT_REGION = 'us'
const DEFAULT_HTTP_TIMEOUT_MS = '15000'

/**
 * Sinch Conversation API credentials. The standalone SMS (XMS) API is
 * end-of-sale, so sends go through the Conversation API's SMS channel instead.
 *
 * Unlike PeerlyBaseConfig this does NOT throw when unset. SMS is an optional
 * delivery channel for magic links (email still works, and the rep can always
 * copy the link), so an unconfigured local or CI environment must still boot.
 * Callers gate on `isConfigured` and surface a `sendError` instead.
 *
 * Env is read per instance rather than once at module load, which keeps the
 * class stubbable in tests. Instances are created once per service at boot, so
 * there is no cost to this.
 */
export class SinchConfig {
  readonly projectId = process.env.SINCH_PROJECT_ID
  readonly keyId = process.env.SINCH_KEY_ID
  readonly keySecret = process.env.SINCH_KEY_SECRET

  /**
   * The Conversation API app that owns the SMS channel. Provisioned in DISPATCH
   * processing mode so Sinch stores no contact or conversation record per lead,
   * which also means sends must address recipients by channel identity rather
   * than by contact id.
   */
  readonly appId = process.env.SINCH_APP_ID

  readonly fromNumber = process.env.SINCH_FROM_NUMBER
  readonly region = process.env.SINCH_REGION || DEFAULT_REGION
  readonly httpTimeoutMs = parseInt(
    process.env.SINCH_HTTP_TIMEOUT_MS || DEFAULT_HTTP_TIMEOUT_MS,
    10,
  )

  /**
   * Non-prod safety valve, mirroring MAILGUN_INTERCEPT_EMAIL: when set, every
   * message is redirected here regardless of the requested recipient, so a dev
   * or QA run can never text a real lead.
   */
  readonly interceptPhone = process.env.SMS_INTERCEPT_PHONE || undefined

  /**
   * HMAC secret for inbound callbacks, chosen by us when registering the webhook
   * and echoed back as a signature on every callback. Callbacks from a webhook
   * registered without a secret arrive unsigned, in which case we cannot tell a
   * real STOP from a forged one — and a forged one can suppress a lead's texts —
   * so the opt-out endpoint fails closed when this is unset.
   */
  readonly webhookSecret = process.env.SINCH_WEBHOOK_SECRET

  get isConfigured(): boolean {
    return Boolean(
      this.projectId &&
      this.keyId &&
      this.keySecret &&
      this.appId &&
      this.fromNumber,
    )
  }

  get messagesSendUrl(): string {
    return `https://${this.region}.conversation.api.sinch.com/v1/projects/${this.projectId}/messages:send`
  }

  /** Region-independent, unlike the send URL. */
  readonly tokenUrl = 'https://auth.sinch.com/oauth2/token'
}
