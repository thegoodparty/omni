/**
 * How the delivery layer hands a finished send to whoever actually sends it.
 *
 * A port, not an import, for two reasons. Today the implementation posts the
 * recipient CSV to a Slack channel for a human to pick up; when a real vendor
 * arrives it becomes an API call plus a stored job id, and nothing above this
 * interface changes. And it lets the delivery service and the Slack helper be
 * built and reviewed independently — the module binds one to the other.
 *
 * See docs/features/serve-sms.md, "Layer 1: Delivery" (Handoff, and Vendor
 * swap for what survives the swap).
 */

/**
 * Everything a handoff needs and nothing the implementation can look up for
 * itself. Deliberately the argument shape of
 * `sendTextDeliverySlackMessage` minus its Slack client, so the binding in
 * the module is a one-line adapter rather than a translation layer.
 */
export interface TextDeliveryHandoff {
  /** The spine outreach id. Scopes the results upload page and the send. */
  outreachId: string
  /** 1 for the first send, >1 for a re-send of the same outreach. */
  sendSeq: number
  /** The text body that goes to recipients, verbatim. */
  message: string
  /** Already formatted for humans; the layer never sends a raw timestamp. */
  scheduledDate: string
  /** Rows in the attached CSV, after the scrub and the phone dedupe. */
  recipientCount: number
  csv: {
    fileContent: Buffer
    filename: string
  }
  imageUrl?: string
  /** Who the send is from. The org owner; see the service for why. */
  officialInfo: { name: string; email: string; phone?: string }
}

export interface TextDeliveryHandoffPort {
  send(handoff: TextDeliveryHandoff): Promise<void>
}

/**
 * Injection token for the port. A string token rather than a class, because
 * the binding is a plain object built from a standalone function (the same
 * reason `AUTH_PROVIDER_TOKEN` is one).
 */
export const TEXT_DELIVERY_HANDOFF_PORT = 'TextDeliveryHandoffPort'
