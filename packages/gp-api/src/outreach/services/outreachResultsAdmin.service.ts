import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { addBusinessDays, parseISO } from 'date-fns'
import type {
  OutreachAwaitingResultsItem,
  OutreachAwaitingResultsResponse,
  OutreachResultsParseReport,
  OutreachResultsTarget,
  OutreachResultsUploadRequest,
} from '@goodparty_org/contracts'
import {
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  checkResultsCsv,
  NO_USABLE_ROWS_MESSAGE,
  type SkippedResultsRow,
} from '../util/outreachResultsCsv.util'
import { OutreachTextIngestService } from './outreachTextIngest.service'

/**
 * The staff side of the inbound half: a results inbox and a per-send upload,
 * both AdminOrM2M-gated, both consumed by gp-admin's
 * `/dashboard/outreach-results` pages.
 *
 * This replaces the `aws s3 cp` line fulfilment runs today. The identity of
 * the send travels to the human (a button in the Slack message) instead of
 * being recalled by them, and the file is reported on before it is
 * committed, because silent partial failure is the failure mode of the path
 * being retired.
 *
 * **SMS only.** Routing an upload by outreach type — writing a poll's file to
 * `input/<pollId>.csv` for the analysis pipeline — is explicitly out of scope
 * (decision 2026-09-21), and the poll Slack message keeps its `aws s3 cp`
 * line. That cut is what makes this slice inert: it adds a path for a product
 * fulfilment has never handled and changes nothing they do today.
 *
 * Nothing here re-implements the ingest. Grouping, phone-to-person mapping
 * with the People DB fallback, the single opt-out predicate, the idempotent
 * writes and the status CAS all live in OutreachTextIngestService, which is
 * shared with the analysis pipeline's producer. This service parses a file
 * and hands over rows.
 *
 * See docs/features/serve-sms.md, "Layer 1: Delivery", Inbound.
 */

// How long after the send fulfilment is expected to have results back. The
// same three business days polls quotes as its estimated completion
// (`estimatedCompletionDate` in polls.service.ts), so the two Serve products
// make one promise rather than two.
const RESULTS_EXPECTED_BUSINESS_DAYS = 3

/**
 * The only two spine states a send may take results in, and the reason the
 * upload path is guarded where `getTarget` is not.
 *
 * `in_progress` is what the delivery layer's claim CAS leaves behind at
 * handoff; `completed` is what this ingest's own CAS leaves behind once
 * results have landed, and it stays uploadable because a re-upload is
 * idempotent. Everything else — `pending`, `pending_payment`, `paid`,
 * `canceled`, `denied` — describes a send that has NOT been dispatched.
 *
 * Without this guard an AdminOrM2M caller could upload against a draft. The
 * ingest would find no recipient map, fall through to the People DB
 * fallback, and attribute the replies to real constituents anyway: message
 * rows written, reply and opt-out events applied to their CRM interaction
 * rows, and the next send's opt-out scrub poisoned — all for a send nobody
 * ever received. `advanceToCompleted`'s CAS refuses the status flip at the
 * very end, but by then every one of those writes is committed, so the CAS
 * is not a substitute for refusing the upload up front.
 */
const UPLOADABLE_STATUSES = [
  OutreachStatus.in_progress,
  OutreachStatus.completed,
] as const

// Only the delivery layer's own producer label reaches the ingest: A6 types
// `sourceLabel` as a closed union of producers, and the request's free-text
// label names a person, not a producer. The person is recorded in this
// service's log line instead — see `logIngest`.
const INGEST_SOURCE = 'staff_upload' as const

// Everything the awaiting-results item is derived from, plus the two fields
// only the upload page needs. One shape for both reads: the extra two columns
// cost nothing and a second select would be a second thing to keep in step.
const SEND_SELECT = {
  id: true,
  name: true,
  status: true,
  outreachType: true,
  organizationSlug: true,
  scheduledLocalDate: true,
  date: true,
  message: true,
  imageUrl: true,
  campaign: { select: { organizationSlug: true } },
} as const

interface SendRow {
  id: number
  name: string | null
  status: OutreachStatus | null
  outreachType: OutreachType
  organizationSlug: string | null
  scheduledLocalDate: string | null
  date: Date | null
  message: string | null
  imageUrl: string | null
  campaign: { organizationSlug: string | null } | null
}

@Injectable()
export class OutreachResultsAdminService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(private readonly ingest: OutreachTextIngestService) {
    super()
  }

  /**
   * The work queue: every text send that has been handed to fulfilment and
   * has not come back yet. It doubles as the way in when the Slack message
   * has scrolled away, which is the point — "we never got results back" is
   * otherwise invisible rather than merely late.
   *
   * `textRecipients: { some: {} }` is the handoff test, not the status: the
   * spine reads `in_progress` from the moment delivery CLAIMS the row, a
   * beat before it resolves the audience, and a claim that then fails is
   * reverted. The recipient map is only written once the CSV exists, so its
   * presence is what actually means "a human has this send".
   */
  async listAwaiting(): Promise<OutreachAwaitingResultsResponse> {
    const sends = await this.model.findMany({
      where: {
        status: OutreachStatus.in_progress,
        outreachType: OutreachType.text,
        textRecipients: { some: {} },
      },
      select: SEND_SELECT,
    })
    if (sends.length === 0) return { items: [] }

    const stats = await this.recipientStats(sends.map((send) => send.id))
    const items = sends
      .map((send) => this.toAwaitingItem(send, stats.get(send.id)))
      .filter((item): item is OutreachAwaitingResultsItem => item !== null)
      // Oldest first: a queue is read top-down and the send that has been
      // waiting longest is the one at risk of being forgotten.
      .sort((a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0))
    return { items }
  }

  /**
   * What the upload page shows before it accepts anything, so the operator
   * can tell they are on the right send. Deliberately not filtered by
   * status: re-upload is idempotent server-side, so a send that already has
   * results stays openable and says so through `resultsReceivedAt`.
   */
  async getTarget(outreachId: number): Promise<OutreachResultsTarget> {
    const send = await this.requireTextSend(outreachId)
    const stats = await this.recipientStats([outreachId])
    const item = this.toAwaitingItem(send, stats.get(outreachId))
    if (!item) {
      // Unreachable in practice: the delivery layer refuses a send with no
      // organization, so a row that reached fulfilment always has one.
      throw new NotFoundException(
        `Outreach ${outreachId} has no organization scope`,
      )
    }
    return {
      ...item,
      message: send.message,
      imageUrl: send.imageUrl,
      resultsReceivedAt: await this.resultsReceivedAt(outreachId),
    }
  }

  /**
   * Parse the file, then hand the rows to the shared ingest.
   *
   * The request carries raw CSV text rather than parsed rows, and this is
   * where it is read. gp-admin parses too, but that is a preflight that
   * saves the operator a round trip: this endpoint is AdminOrM2M-gated and
   * reachable by an M2M token that never loaded the page, so the file is
   * checked again here and nothing the page computed is trusted.
   *
   * `matched` / `unmatched` / `optOuts` are not ours to compute either —
   * they need the recipient map and the one opt-out predicate, both of
   * which live in the ingest.
   */
  async upload(
    outreachId: number,
    input: OutreachResultsUploadRequest,
  ): Promise<OutreachResultsParseReport> {
    await this.requireDispatchedSend(outreachId)

    const parsed = checkResultsCsv(input)
    if (!parsed.ok) throw new BadRequestException(parsed.error)
    if (parsed.rows.length === 0) {
      throw new BadRequestException(NO_USABLE_ROWS_MESSAGE)
    }

    const result = await this.ingest.ingestReplies({
      outreachId,
      rows: parsed.rows,
      sourceLabel: INGEST_SOURCE,
      dryRun: input.dryRun,
    })

    this.logIngest(outreachId, input, parsed.skipped, result.committed)

    // A row the parse threw out (a blank phone cell, an unreadable
    // timestamp) never reached the ingest, so the ingest cannot count it.
    // Fold those in here rather than quietly reporting a smaller file than
    // the operator uploaded: a row with no phone matched nobody, which is
    // what `unmatched` means, and counting it in both keeps the ingest's
    // invariant `matched + unmatched === rowsParsed` true of the report.
    //
    // Outbound rows are NOT folded in. They are the official's own message,
    // one per recipient, so on a 32-person send they outnumber the replies
    // three to one — counting them as unmatched reported 33 unmatched rows
    // when exactly one reply came from a number not on the send, which is
    // the number an operator acts on. They get their own count instead.
    return {
      rowsParsed: result.rowsParsed + parsed.skipped.length,
      outboundRows: parsed.outboundRows,
      matched: result.matched,
      unmatched: result.unmatched + parsed.skipped.length,
      optOuts: result.optOuts,
      committed: result.committed,
    }
  }

  /**
   * 404 rather than 400 for a poll: the results surface is SMS-only in this
   * slice, so from its point of view a poll id names nothing. A 400 would
   * read as "your file was wrong", which would send the operator looking at
   * the file instead of at the link they followed.
   */
  private async requireTextSend(outreachId: number): Promise<SendRow> {
    const send = await this.model.findFirst({
      where: { id: outreachId, outreachType: OutreachType.text },
      select: SEND_SELECT,
    })
    if (!send) {
      throw new NotFoundException(`No text outreach ${outreachId}`)
    }
    return send
  }

  /**
   * The upload's extra gate: a send that fulfilment never received cannot
   * have results. 409 rather than 404 or 400 — the send exists and the file
   * may be perfectly good, it is the send that is in the wrong state, and
   * saying so is what stops the operator re-checking a file that was never
   * the problem.
   *
   * Two conditions, because neither alone is the handoff. The status is the
   * durable answer; the recipient map closes the window between the claim
   * CAS and the map being written, which is the only moment an `in_progress`
   * send has nothing for a reply phone to match against.
   */
  private async requireDispatchedSend(outreachId: number): Promise<SendRow> {
    const send = await this.requireTextSend(outreachId)
    if (!UPLOADABLE_STATUSES.some((status) => status === send.status)) {
      throw new ConflictException(
        `Outreach ${outreachId} has not been sent yet, so it cannot have ` +
          'results. Nothing was written.',
      )
    }
    const dispatched = await this.client.outreachTextRecipient.findFirst({
      where: { outreachId },
      select: { id: true },
    })
    if (!dispatched) {
      throw new ConflictException(
        `Outreach ${outreachId} has no recipients on record, so fulfilment ` +
          'has not received it yet. Nothing was written.',
      )
    }
    return send
  }

  /**
   * One grouped read for the whole queue: the recipient map is both the
   * count fulfilment was given and the record of when they were given it.
   * There is no `sentAt` column on the spine — `date` is null for a Serve
   * send, which fixes 11am local rather than storing an instant.
   */
  private async recipientStats(
    outreachIds: number[],
  ): Promise<Map<number, { count: number; firstWrittenAt: Date | null }>> {
    const grouped = await this.client.outreachTextRecipient.groupBy({
      by: ['outreachId'],
      where: { outreachId: { in: outreachIds } },
      _count: { _all: true },
      _min: { createdAt: true },
    })
    return new Map(
      grouped.map((group) => [
        group.outreachId,
        {
          count: group._count._all,
          firstWrittenAt: group._min.createdAt ?? null,
        },
      ]),
    )
  }

  /** The most recent ingest for this send, or null if none has landed. */
  private async resultsReceivedAt(outreachId: number): Promise<Date | null> {
    const latest = await this.client.pollIndividualMessage.aggregate({
      where: {
        outreachId,
        sender: PollIndividualMessageSender.CONSTITUENT,
      },
      _max: { createdAt: true },
    })
    return latest._max.createdAt ?? null
  }

  private toAwaitingItem(
    send: SendRow,
    stats: { count: number; firstWrittenAt: Date | null } | undefined,
  ): OutreachAwaitingResultsItem | null {
    // Win rows scope by campaign, Serve rows by organization; the contract
    // carries one slug and this layer serves both surfaces.
    const organizationSlug =
      send.organizationSlug ?? send.campaign?.organizationSlug ?? null
    if (!organizationSlug) {
      this.logger.warn(
        { outreachId: send.id },
        '[Outreach Results] send has no organization scope; omitting from the results queue',
      )
      return null
    }
    const sentAt = stats?.firstWrittenAt ?? null
    return {
      outreachId: send.id,
      name: send.name,
      organizationSlug,
      outreachType: send.outreachType,
      recipientCount: stats?.count ?? 0,
      sentAt,
      expectedBy: this.expectedBy(send, sentAt),
    }
  }

  private expectedBy(send: SendRow, sentAt: Date | null): Date | null {
    // The day the send was scheduled for is what fulfilment works from. A
    // Serve row carries only `scheduledLocalDate`; a Win row carries only
    // `date`; the handoff timestamp is the last resort.
    const scheduled = send.scheduledLocalDate
      ? parseISO(send.scheduledLocalDate)
      : (send.date ?? sentAt)
    if (!scheduled || Number.isNaN(scheduled.getTime())) return null
    return addBusinessDays(scheduled, RESULTS_EXPECTED_BUSINESS_DAYS)
  }

  private logIngest(
    outreachId: number,
    input: OutreachResultsUploadRequest,
    skipped: SkippedResultsRow[],
    committed: boolean,
  ) {
    this.logger.info(
      {
        outreachId,
        fileName: input.fileName,
        // The request's free-text label ("gp-admin upload by <email>"): who
        // returned this file, for a send whose results nobody could
        // otherwise trace back. The ingest takes a producer name, not a
        // person, so this is where the person is recorded.
        sourceLabel: input.sourceLabel,
        dryRun: input.dryRun,
        committed,
        skippedRows: skipped.length,
        // Bounded: enough to point at the spreadsheet rows to fix, not the
        // whole file back in the log.
        firstSkipped: skipped.slice(0, 10),
      },
      committed
        ? '[Outreach Results] staff upload committed'
        : '[Outreach Results] staff upload dry run',
    )
  }
}
