import { Injectable, NotImplementedException } from '@nestjs/common'

/**
 * The shared delivery layer's outbound half. Knows nothing about polls or
 * SMS: it resolves an audience, scrubs opt-outs, dedupes by phone, captures
 * the phone-to-person map, and hands the send to fulfilment.
 *
 * The test for whether something belongs here: would it still be true if we
 * swapped Slack for a real vendor? Scrubbing opt-outs, yes. Ranking themes,
 * no — that is the polls layer.
 *
 * See docs/features/serve-sms.md, "Layer 1: Delivery".
 */

/**
 * Who to reach. The product resolves its own audience; delivery owns what
 * happens to it.
 *
 * The sample branch exists on day one even though only polls will pass one,
 * and nothing calls it that way yet. That is deliberate: if the sample branch
 * does not work, the layer is not actually shared, and we would not find out
 * until polls tried to move onto it.
 */
export type TextDeliveryAudience =
  | { kind: 'savedFilter'; voterFileFilterId: number }
  | { kind: 'sample'; size: number; excludePersonIds?: string[] }

export interface RequestSendInput {
  /** The envelope. Org-scoped; a Serve row carries no campaignId. */
  outreachId: number
  audience: TextDeliveryAudience
  /** Sent verbatim. Delivery never edits the message. */
  message: string
  imageUrl?: string
  /** Local calendar day, "YYYY-MM-DD". Serve sends at a fixed 11am local. */
  scheduledLocalDate: string
  /** 1, then incremented per expansion. Keys the CSV so retries reuse it. */
  sendSeq: number
}

export interface RequestSendResult {
  recipientCount: number
  excludedOptedOutCount: number
  excludedDuplicateCount: number
  /** The deterministic S3 key this send's recipient CSV was written under. */
  sendKey: string
}

@Injectable()
export class OutreachTextDeliveryService {
  /**
   * Resolve, scrub, capture, hand off. Idempotent: a redelivered queue
   * message reuses the CSV at `sendKey` rather than resampling a different
   * audience, and both capture writes are skipDuplicates.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async requestSend(_input: RequestSendInput): Promise<RequestSendResult> {
    throw new NotImplementedException('requestSend: delivery outbound slice')
  }
}
