import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addDays, format, isBefore, isValid, parse, subDays } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { phoneDigitsKey } from 'src/shared/util/strings.util'
import { Outreach, OutreachType } from '../../generated/prisma'
import {
  ContactInteractionTextService,
  InboundTextEventType,
} from '../../contactInteraction/services/contactInteractionText.service'
import {
  PeerlyCdrCsvRow,
  PeerlyQuestionResponsesCsvRow,
} from '../../vendors/peerly/schemas/peerlyJobResultsReport.schema'
import {
  PeerlyJobResultsService,
  PeerlyReportDateWindow,
} from '../../vendors/peerly/services/peerlyJobResults.service'
import { PeerlyPhoneListCaptureService } from '../../vendors/peerly/services/peerlyPhoneListCapture.service'

// Offset from the completion sweep (:00) so the two hourly Peerly pollers
// don't stack their request bursts on the same minute.
const OUTREACH_INBOUND_SWEEP_CRON = '30 * * * *'

// Replies trickle in after a job stops sending; two weeks covers the long
// tail without polling dead jobs forever. The window is anchored on
// updatedAt (bumped when the completion sweep marks the job done) OR the
// scheduled send date, because outreach rows carry no completedAt and the
// completion predicate is known-unreliable (ENG-10727) — a job whose status
// never reaches `completed` still ages out of the sweep.
export const INBOUND_SWEEP_WINDOW_DAYS = 14

// The only Direction value observed in dev (ENG-10727). No dev job has
// inbound traffic, so the inbound literal is unverified — any non-outbound
// row is treated as a reply rather than matched against a guessed literal.
const PEERLY_CDR_OUTBOUND_DIRECTION = 'sent'

// The optout column's value vocabulary is unverified (no dev job has an
// opt-out). Anything outside these explicit falsy literals counts as an
// opt-out, and the raw value is logged so the real vocabulary gets learned.
const OPTOUT_FALSY_VALUES = new Set(['', '0', 'false'])

const PEERLY_REPORT_DATE_FORMAT = 'yyyy-MM-dd'

const isOptedOut = (value: string): boolean =>
  !OPTOUT_FALSY_VALUES.has(value.trim().toLowerCase())

interface InboundEvent {
  sourceEventId: string
  personIds: string[]
  eventType: InboundTextEventType
  eventTimestamp?: Date
}

// Report timestamps read 'YYYY-MM-DD HH:MM:SS' (or date-only) with no
// offset, and the timezone is unverified (ENG-10727) — parse as
// server-local time as the best available approximation. Anything
// unparseable falls back to the sweep's wall-clock at the call site.
const REPORT_TIMESTAMP_FORMATS = ['yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd']
const parseReportTimestamp = (value: string): Date | undefined => {
  for (const timestampFormat of REPORT_TIMESTAMP_FORMATS) {
    const parsed = parse(value.trim(), timestampFormat, new Date())
    if (isValid(parsed)) return parsed
  }
  return undefined
}

interface SweepCounters {
  jobsPolled: number
  jobsFailed: number
  jobsWithoutCapture: number
  repliesApplied: number
  optOutsApplied: number
  skippedDuplicate: number
  skippedAlreadyApplied: number
  skippedUnmatched: number
  skippedNoRow: number
  inboundRowsSeen: number
}

type SweepableOutreach = Outreach & {
  campaign: { organizationSlug: string }
}

@Injectable()
export class OutreachInboundSweepService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(
    private readonly peerlyJobResults: PeerlyJobResultsService,
    private readonly peerlyPhoneListCapture: PeerlyPhoneListCaptureService,
    private readonly textInteractions: ContactInteractionTextService,
  ) {
    super()
  }

  // Scope: only text/p2p outreaches with both a Peerly job (projectId) and a
  // Peerly list id (phoneListId) — without the list there are no captured
  // recipients to map inbound phones to. Reports export the whole job window
  // per call (no cursoring), so idempotency rides on sourceEventId, not on
  // "since last sweep" bookkeeping.
  @Cron(OUTREACH_INBOUND_SWEEP_CRON, { name: 'outreachInboundSweep' })
  async sweepInboundEvents(): Promise<void> {
    const now = new Date()
    const windowStart = subDays(now, INBOUND_SWEEP_WINDOW_DAYS)
    const candidates = await this.model.findMany({
      where: {
        projectId: { not: null },
        phoneListId: { not: null },
        outreachType: { in: [OutreachType.text, OutreachType.p2p] },
        OR: [
          { date: { gte: windowStart } },
          { updatedAt: { gte: windowStart } },
        ],
      },
      include: { campaign: { select: { organizationSlug: true } } },
    })

    const counters: SweepCounters = {
      jobsPolled: 0,
      jobsFailed: 0,
      jobsWithoutCapture: 0,
      repliesApplied: 0,
      optOutsApplied: 0,
      skippedDuplicate: 0,
      skippedAlreadyApplied: 0,
      skippedUnmatched: 0,
      skippedNoRow: 0,
      inboundRowsSeen: 0,
    }
    let agedJobsPolled = 0

    for (const outreach of candidates) {
      try {
        const polled = await this.sweepOutreach(outreach, now, counters)
        if (!polled) {
          counters.jobsWithoutCapture += 1
          continue
        }
        counters.jobsPolled += 1
        const sendAnchor = outreach.date ?? outreach.createdAt
        if (isBefore(sendAnchor, subDays(now, 1))) {
          agedJobsPolled += 1
        }
      } catch (err) {
        // One job's Peerly/download/parse failure must not abort the sweep
        // for the rest, and must not page — this only logs.
        counters.jobsFailed += 1
        this.logger.warn(
          { err, outreachId: outreach.id, projectId: outreach.projectId },
          '[Outreach Inbound] job sweep failed; will retry next sweep',
        )
      }
    }

    this.logger.info({ ...counters }, '[Outreach Inbound] sweep summary')
    if (agedJobsPolled > 0 && counters.inboundRowsSeen === 0) {
      this.logger.warn(
        { agedJobsPolled, jobsPolled: counters.jobsPolled },
        '[Outreach Inbound] sends older than a day produced zero inbound ' +
          'events — possible ingestion gap (unverified CDR Direction ' +
          'literal, or a Peerly report format change)',
      )
    }
  }

  // Returns false when the outreach has no captured phone list (built
  // before capture shipped, or the capture write failed) — inbound phones
  // can't be mapped to people, so Peerly isn't polled at all.
  private async sweepOutreach(
    outreach: SweepableOutreach,
    now: Date,
    counters: SweepCounters,
  ): Promise<boolean> {
    const jobId = outreach.projectId
    if (!jobId || !outreach.phoneListId) return false

    const phoneList = await this.peerlyPhoneListCapture.findFirst({
      where: {
        peerlyListId: outreach.phoneListId,
        campaignId: outreach.campaignId,
      },
    })
    if (!phoneList) {
      this.logger.info(
        { outreachId: outreach.id, phoneListId: outreach.phoneListId },
        '[Outreach Inbound] no captured recipients for this phone list; ' +
          'inbound events cannot be mapped — skipping job',
      )
      return false
    }

    const recipients =
      await this.peerlyPhoneListCapture.findRecipientsWithPhones(phoneList.id)
    const phoneToPersonIds = new Map<string, string[]>()
    for (const { personId, phone } of recipients) {
      const key = phoneDigitsKey(phone)
      if (!key) continue
      const existing = phoneToPersonIds.get(key)
      if (existing) {
        existing.push(personId)
      } else {
        phoneToPersonIds.set(key, [personId])
      }
    }

    // Padded a day on each side: Peerly evaluates the range in its account
    // timezone while these timestamps are server-local, and a boundary
    // mismatch would silently drop the job's first or last day of events.
    const window: PeerlyReportDateWindow = {
      startDate: format(
        subDays(outreach.createdAt, 1),
        PEERLY_REPORT_DATE_FORMAT,
      ),
      endDate: format(addDays(now, 1), PEERLY_REPORT_DATE_FORMAT),
    }
    const cdrRows = await this.peerlyJobResults.fetchCdrRows(jobId, window)
    const questionRows = await this.peerlyJobResults.fetchQuestionResponseRows(
      jobId,
      window,
    )

    const events = [
      ...this.collectReplyEvents(jobId, cdrRows, phoneToPersonIds, counters),
      ...this.collectOptOutEvents(
        jobId,
        questionRows,
        phoneToPersonIds,
        counters,
      ),
    ]
    await this.applyEvents(outreach, events, now, counters)
    return true
  }

  private collectReplyEvents(
    jobId: string,
    rows: PeerlyCdrCsvRow[],
    phoneToPersonIds: Map<string, string[]>,
    counters: SweepCounters,
  ): InboundEvent[] {
    const events: InboundEvent[] = []
    for (const row of rows) {
      if (
        row.Direction.trim().toLowerCase() === PEERLY_CDR_OUTBOUND_DIRECTION
      ) {
        continue
      }
      // A trailing blank CSV line parses as an all-empty row; it isn't an
      // inbound event.
      if (!row.From && !row.To) continue
      counters.inboundRowsSeen += 1
      // The lead's number is whichever side of the row appears in the
      // captured list — the other side is our DID, which is never a
      // captured recipient, so this can't mis-attribute even though the
      // inbound Direction literal (and column orientation) is unverified.
      const phoneKey = [row.From, row.To]
        .map(phoneDigitsKey)
        .find((key): key is string => key !== null && phoneToPersonIds.has(key))
      const personIds = phoneKey ? phoneToPersonIds.get(phoneKey) : undefined
      if (!phoneKey || !personIds) {
        counters.skippedUnmatched += 1
        continue
      }
      events.push({
        sourceEventId: `peerly:${jobId}:${phoneKey}:reply`,
        personIds,
        eventType: 'reply',
        eventTimestamp: parseReportTimestamp(row.Timestamp),
      })
    }
    return events
  }

  private collectOptOutEvents(
    jobId: string,
    rows: PeerlyQuestionResponsesCsvRow[],
    phoneToPersonIds: Map<string, string[]>,
    counters: SweepCounters,
  ): InboundEvent[] {
    const events: InboundEvent[] = []
    for (const row of rows) {
      if (!isOptedOut(row.optout)) continue
      counters.inboundRowsSeen += 1
      // The raw flag value is worth learning (vocabulary unverified); it is
      // not PII, unlike the rest of the row.
      this.logger.info(
        { jobId, optoutValue: row.optout },
        '[Outreach Inbound] opt-out row observed',
      )
      const phoneKey = phoneDigitsKey(row.lead_phone)
      const personIds = phoneKey ? phoneToPersonIds.get(phoneKey) : undefined
      if (!phoneKey || !personIds) {
        counters.skippedUnmatched += 1
        continue
      }
      events.push({
        sourceEventId: `peerly:${jobId}:${phoneKey}:optout`,
        personIds,
        eventType: 'optout',
        eventTimestamp: parseReportTimestamp(row.date),
      })
    }
    return events
  }

  private async applyEvents(
    outreach: SweepableOutreach,
    events: InboundEvent[],
    now: Date,
    counters: SweepCounters,
  ): Promise<void> {
    const eventsById = new Map<string, InboundEvent>()
    for (const event of events) {
      if (!eventsById.has(event.sourceEventId)) {
        eventsById.set(event.sourceEventId, event)
      }
    }
    const uniqueEvents = [...eventsById.values()]
    // Pre-screen against already-recorded events so a full re-export is
    // mostly a read; the (organizationSlug, sourceEventId) unique index and
    // the null-timestamp guards in applyInboundEvent are the backstop.
    const existingIds = await this.textInteractions.findExistingSourceEventIds(
      outreach.campaign.organizationSlug,
      uniqueEvents.map((event) => event.sourceEventId),
    )

    for (const event of uniqueEvents) {
      if (existingIds.has(event.sourceEventId)) {
        counters.skippedDuplicate += 1
        continue
      }
      const outcome = await this.textInteractions.applyInboundEvent({
        outreachId: outreach.id,
        personIds: event.personIds,
        eventType: event.eventType,
        sourceEventId: event.sourceEventId,
        observedAt: event.eventTimestamp ?? now,
      })
      if (outcome === 'applied') {
        if (event.eventType === 'reply') {
          counters.repliesApplied += 1
        } else {
          counters.optOutsApplied += 1
        }
      } else if (outcome === 'alreadyApplied') {
        counters.skippedAlreadyApplied += 1
      } else {
        counters.skippedNoRow += 1
        // Should be impossible once materialization (task 03) runs at
        // launch; never create a row here — that would corrupt the
        // one-row-per-recipient invariant.
        this.logger.warn(
          { outreachId: outreach.id, eventType: event.eventType },
          '[Outreach Inbound] inbound event matched a captured recipient ' +
            'with no materialized interaction row; skipped',
        )
      }
    }
  }
}
