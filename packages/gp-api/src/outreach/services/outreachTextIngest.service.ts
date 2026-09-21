import { Injectable, NotImplementedException } from '@nestjs/common'

/**
 * The shared delivery layer's inbound half. One writer, two producers: SMS
 * rows are parsed straight out of the staff upload, poll rows come back from
 * the analysis pipeline's artifact after the same upload has been through it.
 * Neither producer is visible to whoever uploaded the file.
 *
 * Nothing in here is product-specific. Polls adds a step on top that writes
 * themes; SMS never clusters at all.
 *
 * See docs/features/serve-sms.md, "Layer 1: Delivery", Inbound.
 */

export interface IngestReplyRow {
  phone: string
  content: string
  receivedAt?: Date
}

export interface IngestRepliesInput {
  outreachId: number
  rows: IngestReplyRow[]
  /** Which producer, for the audit trail. */
  sourceLabel: 'staff_upload' | 'analysis_pipeline'
  /**
   * Parse and report without writing. The staff upload page runs a dry run
   * first and shows the counts before committing, because silent partial
   * failure is the failure mode of the path it replaces.
   */
  dryRun?: boolean
}

export interface IngestRepliesResult {
  rowsParsed: number
  matched: number
  /** Rows whose number belongs to nobody on this send. Logged, never thrown. */
  unmatched: number
  optOuts: number
  committed: boolean
}

@Injectable()
export class OutreachTextIngestService {
  /**
   * Map phone to person, write the message rows, and apply reply/opt-out
   * events onto ContactInteractionText.
   *
   * Two invariants worth keeping when this is filled in:
   *  - An unattributable reply is skipped and logged, never thrown. Throwing
   *    bubbles to SQS and redelivers forever, blocking every other reply in
   *    the batch.
   *  - Opt-out is decided by one predicate in this layer, applied to every
   *    row regardless of producer. The pipeline's own isOptOut flag is a
   *    hint, not the source of truth, or the two definitions drift.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async ingestReplies(
    _input: IngestRepliesInput,
  ): Promise<IngestRepliesResult> {
    throw new NotImplementedException('ingestReplies: delivery inbound slice')
  }
}
