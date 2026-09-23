import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { addBusinessDays, parseISO } from 'date-fns'
import type {
  OutreachAwaitingResultsItem,
  ResultsInboxKind,
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
import { S3Service } from '@/vendors/aws/services/s3.service'
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
  constructor(
    private readonly ingest: OutreachTextIngestService,
    private readonly s3Service: S3Service,
  ) {
    super()
  }

  /**
   * A poll's results go to S3 and nowhere else. This is the whole poll
   * branch of the upload, and it is deliberately tiny: the object landing
   * under `input/` is what an existing S3 notification watches for, which
   * fires a Lambda, which starts the Step Function, which runs the Fargate
   * analysis. None of that changes — this replaces the human running
   * `aws s3 cp`, and nothing else about how a poll is processed.
   *
   * Byte-for-byte what fulfilment produced. We parse the file to REPORT on
   * it, never to transform it: the pipeline does its own parsing with its
   * own expectations, and handing it a re-serialized file would make this
   * service a second author of a format it does not own.
   */
  private async writePollResultsToPipeline(
    pollId: string,
    csv: string,
  ): Promise<void> {
    const bucket = process.env.SERVE_ANALYSIS_BUCKET_NAME
    if (!bucket) {
      throw new Error(
        'SERVE_ANALYSIS_BUCKET_NAME is required to accept poll results',
      )
    }
    // The exact key the Slack message's CLI line names, because the
    // notification filter is `input/` + `.csv` and the pipeline reads the
    // poll id back out of the object key.
    await this.s3Service.uploadFile(bucket, csv, `input/${pollId}.csv`, {
      contentType: 'text/csv',
    })
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
    const [sends, polls] = await Promise.all([
      this.listAwaitingSends(),
      this.listAwaitingPolls(new Date()),
    ])
    return {
      // Oldest first across BOTH products: a queue is read top-down and the
      // work waiting longest is the one at risk of being forgotten, whether
      // it is a text send or a poll. Sorting per-product would bury an old
      // poll under fresh sends.
      items: [...sends, ...polls].sort(
        (a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0),
      ),
    }
  }

  private async listAwaitingSends(): Promise<OutreachAwaitingResultsItem[]> {
    const sends = await this.model.findMany({
      where: {
        status: OutreachStatus.in_progress,
        outreachType: OutreachType.text,
        textRecipients: { some: {} },
      },
      select: SEND_SELECT,
    })
    if (sends.length === 0) return []

    const stats = await this.recipientStats(sends.map((send) => send.id))
    return sends
      .map((send) => this.toAwaitingItem(send, stats.get(send.id)))
      .filter((item): item is OutreachAwaitingResultsItem => item !== null)
  }

  /**
   * Polls awaiting results, in the same inbox as the text sends. One queue,
   * because fulfilment does one job and should not have to remember which
   * product a Slack message was about.
   *
   * "Awaiting" is `isCompleted: false` past its scheduled date. A poll has
   * no spine status and no recipient map — the only thing that marks it
   * done is the analysis pipeline writing back, which flips `isCompleted`
   * and fills `responseCount`. So an incomplete poll whose send date has
   * passed is exactly a poll whose results have not come back.
   */
  private async listAwaitingPolls(
    now: Date,
  ): Promise<OutreachAwaitingResultsItem[]> {
    const polls = await this.client.poll.findMany({
      where: { isCompleted: false, scheduledDate: { lte: now } },
      select: {
        id: true,
        name: true,
        targetAudienceSize: true,
        scheduledDate: true,
        estimatedCompletionDate: true,
        electedOffice: { select: { organizationSlug: true } },
      },
    })
    return polls.flatMap((poll) => {
      const organizationSlug = poll.electedOffice?.organizationSlug
      if (!organizationSlug) {
        // Same treatment as a scopeless send: omitted rather than shown
        // without an owner, because the inbox is read per organization.
        this.logger.warn(
          { pollId: poll.id },
          '[Outreach Results] poll has no organization scope; omitting from the results queue',
        )
        return []
      }
      return [
        {
          kind: 'poll' as const,
          id: poll.id,
          name: poll.name,
          organizationSlug,
          outreachType: 'poll',
          // The audience it was sent to. A poll has no per-person recipient
          // rows, so this is the closest true number — and it is what the
          // operator recognizes the poll by.
          recipientCount: poll.targetAudienceSize,
          sentAt: poll.scheduledDate,
          expectedBy: poll.estimatedCompletionDate,
        },
      ]
    })
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
  /**
   * The poll half of the one upload path. Same page, same button, same
   * report shape — the operator does not need to know which product they
   * are looking at, which is the point of unifying the surface.
   *
   * What differs is everything after validation. An SMS file is INGESTED:
   * parsed into rows, matched against the recipient map, written as
   * messages and CRM events. A poll file is FORWARDED: the bytes go to
   * `input/<pollId>.csv` and the existing pipeline takes over, exactly as
   * it did when a human ran `aws s3 cp`. We never write poll rows here.
   *
   * So `matched` / `unmatched` / `optOuts` are null for a poll rather than
   * zero. There is no recipient map to match against and no opt-out
   * predicate run, and reporting 0 would read as "nobody replied" when the
   * truth is "that question is not ours to answer" — the pipeline answers
   * it later, asynchronously, by writing PollIssues.
   */
  /**
   * The two entry points the controller actually calls. Everything above is
   * one product or the other; these are the seam where the single upload
   * path picks which.
   *
   * An SMS id arrives as a string off the URL and is parsed here rather
   * than by a pipe, because the pipe would have to run before we know which
   * kind we are dealing with — and a uuid through ParseIntPipe is a 400
   * about the wrong thing.
   */
  private parseSendId(id: string): number {
    const outreachId = Number(id)
    if (!Number.isInteger(outreachId) || outreachId <= 0) {
      throw new BadRequestException(`"${id}" is not an outreach id`)
    }
    return outreachId
  }

  async getTargetByKind(
    kind: ResultsInboxKind,
    id: string,
  ): Promise<OutreachResultsTarget> {
    return kind === 'poll'
      ? this.getPollTarget(id)
      : this.getTarget(this.parseSendId(id))
  }

  async uploadByKind(
    kind: ResultsInboxKind,
    id: string,
    input: OutreachResultsUploadRequest,
  ): Promise<OutreachResultsParseReport> {
    return kind === 'poll'
      ? this.uploadPollResults(id, input)
      : this.upload(this.parseSendId(id), input)
  }

  /**
   * What the upload page shows for a poll, in the same shape it shows a
   * send — the operator should not be able to tell from the page which
   * product they are on, only from the content.
   *
   * `message` is the poll's question, which is the thing fulfilment
   * actually sent and therefore the thing they can recognize.
   */
  async getPollTarget(pollId: string): Promise<OutreachResultsTarget> {
    const poll = await this.client.poll.findUnique({
      where: { id: pollId },
      select: {
        id: true,
        name: true,
        messageContent: true,
        imageUrl: true,
        targetAudienceSize: true,
        scheduledDate: true,
        estimatedCompletionDate: true,
        completedDate: true,
        electedOffice: { select: { organizationSlug: true } },
      },
    })
    if (!poll) throw new NotFoundException(`No poll ${pollId}`)
    const organizationSlug = poll.electedOffice?.organizationSlug
    if (!organizationSlug) {
      throw new NotFoundException(`Poll ${pollId} has no organization scope`)
    }
    return {
      kind: 'poll',
      id: poll.id,
      name: poll.name,
      organizationSlug,
      outreachType: 'poll',
      recipientCount: poll.targetAudienceSize,
      sentAt: poll.scheduledDate,
      expectedBy: poll.estimatedCompletionDate,
      message: poll.messageContent,
      imageUrl: poll.imageUrl,
      // A poll has no per-send results row; the pipeline marks it done by
      // filling completedDate, so that is what "results are in" means here.
      resultsReceivedAt: poll.completedDate,
    }
  }

  async uploadPollResults(
    pollId: string,
    input: OutreachResultsUploadRequest,
  ): Promise<OutreachResultsParseReport> {
    const poll = await this.client.poll.findUnique({
      where: { id: pollId },
      select: { id: true },
    })
    if (!poll) throw new NotFoundException(`No poll ${pollId}`)

    // Validated for the same reason the SMS path is: a truncated or
    // wrong-shaped file caught here costs a second, and caught by the
    // pipeline costs a Fargate run and a confusing empty result. The parse
    // is a REPORT on the bytes, never a rewrite of them.
    const parsed = checkResultsCsv(input)
    if (!parsed.ok) throw new BadRequestException(parsed.error)
    if (parsed.rows.length === 0) {
      throw new BadRequestException(NO_USABLE_ROWS_MESSAGE)
    }

    if (!input.dryRun) {
      await this.writePollResultsToPipeline(pollId, input.csv)
    }

    this.logger.info(
      {
        pollId,
        fileName: input.fileName,
        sourceLabel: input.sourceLabel,
        rowsParsed: parsed.rows.length,
        outboundRows: parsed.outboundRows,
        skippedRows: parsed.skipped.length,
        dryRun: input.dryRun,
      },
      '[Outreach Results] poll results forwarded to the analysis pipeline',
    )

    return {
      rowsParsed: parsed.rows.length,
      outboundRows: parsed.outboundRows,
      matched: null,
      unmatched: null,
      optOuts: null,
      committed: !input.dryRun,
    }
  }

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
      kind: 'sms',
      // Stringified because a poll's id is a uuid and the inbox carries
      // both. `kind` is what tells a reader which table to look in.
      id: String(send.id),
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
