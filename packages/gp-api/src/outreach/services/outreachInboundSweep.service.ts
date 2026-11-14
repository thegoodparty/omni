import { GatewayTimeoutException, Injectable } from '@nestjs/common'
import {
  addDays,
  addMinutes,
  compareAsc,
  compareDesc,
  differenceInMilliseconds,
  format,
  getHours,
  isAfter,
  isBefore,
  isValid,
  parse,
  startOfDay,
  subDays,
  subHours,
} from 'date-fns'
import ms from 'ms'
import { setTimeout as delay } from 'node:timers/promises'
import pMap from 'p-map'
import { v5 as uuidv5 } from 'uuid'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { phoneDigitsKey } from 'src/shared/util/strings.util'
import {
  Outreach,
  OutreachType,
  PollIndividualMessageSender,
  Prisma,
} from '../../generated/prisma'
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
import { isOptOutMessage } from '../util/textOptOut.util'

// Peerly's AI and its texters flag opt-outs whose wording never contains a
// stop word, and those flags exist only in the question-responses report.
// Peerly builds that report while we wait (up to ~3 minutes for a big job,
// whatever the window), far too slow to read for every job every hour, so
// each job's report is read at most every OPT_OUT_RECONCILE_INTERVAL_HOURS
// as a backstop to the reply-text matching. The pass runs hourly so each
// one stays short: a single pass over every job ran past three hours and
// was cut off by deploys before it finished (2026-10-20).

export const OPT_OUT_RECONCILE_INTERVAL_HOURS = 6

// Passes start a few milliseconds apart from hour to hour, so an exact
// six-hour cutoff would push about half the reads to the seventh pass.
const OPT_OUT_RECONCILE_INTERVAL_SLACK_MINUTES = 30

// Peerly flags an opt-out on a reply, and replies land soon after the text:
// on 12 jobs sent 10-14 days earlier, 252 of the 258 opt-outs only Peerly
// flagged had their last reply within 3 days of the person's first text
// (2026-10-20). A job sends on one day (outreachCompletion.service.ts), so
// that is also 3 days from the send.
export const OPT_OUT_RECONCILE_WINDOW_DAYS = 3

// No report starts after this. With the last ones still building
// (OPT_OUT_REPORT_TIMEOUT_MS), a pass ends long before the next hour's
// starts, and nothing else stops two passes reading the same job at once.
export const OPT_OUT_RECONCILE_BUDGET_MS = ms('20m')

// Peerly builds two reports at once as fast as one: two big jobs took 63s
// and 87s requested together, 71s and 96s one at a time (2026-10-20).
export const OPT_OUT_RECONCILE_CONCURRENCY = 2

// Above the ~170s a big job's report has taken to build. A retry would ask
// Peerly to build the same report again from scratch, so one attempt only.
const OPT_OUT_REPORT_TIMEOUT_MS = ms('5m')

// dev and prod only, never every PR-preview stack against one shared
// Peerly budget (docs/scheduled-jobs.md). Fail-closed: an absent or
// unexpected value (local, vitest) skips. Read live so a test can stub it.
const INBOUND_SWEEP_DEPLOY_ENVIRONMENTS = new Set(['dev', 'prod'])

const isSweepDeploy = (): boolean =>
  INBOUND_SWEEP_DEPLOY_ENVIRONMENTS.has(
    process.env.OTEL_SERVICE_ENVIRONMENT ?? '',
  )

// Replies trickle in after a job stops sending; two weeks covers the long
// tail without polling dead jobs forever. The window is anchored on
// updatedAt (bumped when the completion sweep marks the job done) OR the
// scheduled send date, because outreach rows carry no completedAt and the
// completion predicate is known-unreliable (ENG-10727) — a job whose status
// never reaches `completed` still ages out of the sweep.
export const INBOUND_SWEEP_WINDOW_DAYS = 14

// Peerly asked us to cut re-export volume (2026-09-04): most replies land in
// the first couple days after a send, so only jobs younger than this poll
// every hourly pass — the rest of the 14-day tail backs off to
// INBOUND_SWEEP_AGED_HOUR_INTERVAL.
export const INBOUND_SWEEP_FRESH_WINDOW_DAYS = 2

// An aged job is only swept on hours divisible by this (4x/day) instead of
// every hourly pass — cuts a dead job's remaining ~12 days of re-exports by
// ~6x while still catching a late opt-out same-day.
export const INBOUND_SWEEP_AGED_HOUR_INTERVAL = 6

// The optout column's value vocabulary is unverified (no dev job has an
// opt-out). Anything outside these explicit falsy literals counts as an
// opt-out, and the raw value is logged so the real vocabulary gets learned.
// Vocabulary unverified (no dev job has an opt-out): cover the common
// negations so a 'no'-encoded column can't mass-write optedOutAt before
// the real values are learned from the logged raw flags.
const OPTOUT_FALSY_VALUES = new Set(['', '0', 'false', 'no', 'n'])

const PEERLY_REPORT_DATE_FORMAT = 'yyyy-MM-dd'

// Verified against prod: every CDR row reads 'sent' or 'received'. Any
// non-outbound row still counts as a reply, but only an exact 'received'
// row is read for an opt-out — an opt-out scrubs the person org-wide and
// forever, and our own templates say "Reply STOP to opt out", so an
// outbound row mislabeled by a new Direction value must never get here.
const PEERLY_CDR_INBOUND_DIRECTION = 'received'

// Win reply text is stored where Serve's is, so every reply reader already
// finds it. Peerly gives a CDR row no message id; the content is part of
// the key because a person can send two texts in the same second.
const WIN_REPLY_MESSAGE_NAMESPACE = '8628e340-b4b4-4305-a03f-cda3668a2a79'

const isOptedOut = (value: string): boolean =>
  !OPTOUT_FALSY_VALUES.has(value.trim().toLowerCase())

interface InboundEvent {
  sourceEventId: string
  personIds: string[]
  eventType: InboundTextEventType
  eventTimestamp?: Date
}

// The CDR's timestamps read 'YYYY-MM-DD HH:MM:SS' (or date-only) with no
// offset, and the timezone is unverified (ENG-10727) — parse as
// server-local time as the best available approximation. The
// question-responses report appends the offset ('... -0400'), which is
// exact. Anything unparseable falls back to the sweep's wall-clock at the
// call site.
const REPORT_TIMESTAMP_FORMATS = [
  'yyyy-MM-dd HH:mm:ss xx',
  'yyyy-MM-dd HH:mm:ss',
  'yyyy-MM-dd',
]

const parseReportTimestamp = (value: string): Date | undefined => {
  for (const timestampFormat of REPORT_TIMESTAMP_FORMATS) {
    // startOfDay reference: parse fills unspecified fields from it, so a
    // date-only value lands on midnight, not the cron's wall-clock.
    const parsed = parse(value.trim(), timestampFormat, startOfDay(new Date()))
    if (isValid(parsed)) return parsed
  }
  return undefined
}

// The lead's number is whichever side of the row appears in the captured
// list — the other side is our DID, which is never a captured recipient, so
// this can't mis-attribute even for a row whose Direction or column
// orientation is unexpected.
const matchCdrRow = (
  row: PeerlyCdrCsvRow,
  phoneToPersonIds: Map<string, string[]>,
): { phoneKey: string; personIds: string[] } | null => {
  for (const phoneKey of [row.From, row.To].map(phoneDigitsKey)) {
    const personIds = phoneKey ? phoneToPersonIds.get(phoneKey) : undefined
    if (phoneKey && personIds) return { phoneKey, personIds }
  }
  return null
}

interface SweepCounters {
  jobsPolled: number
  jobsFailed: number
  jobsWithoutCapture: number
  jobsSkippedFuture: number
  jobsSkippedAgedCadence: number
  repliesApplied: number
  optOutsApplied: number
  skippedDuplicate: number
  skippedAlreadyApplied: number
  skippedUnmatched: number
  skippedNoRow: number
  inboundRowsSeen: number
  unexpectedDirectionRows: number
  messagesWritten: number
}

const emptySweepCounters = (): SweepCounters => ({
  jobsPolled: 0,
  jobsFailed: 0,
  jobsWithoutCapture: 0,
  jobsSkippedFuture: 0,
  jobsSkippedAgedCadence: 0,
  repliesApplied: 0,
  optOutsApplied: 0,
  skippedDuplicate: 0,
  skippedAlreadyApplied: 0,
  skippedUnmatched: 0,
  skippedNoRow: 0,
  inboundRowsSeen: 0,
  unexpectedDirectionRows: 0,
  messagesWritten: 0,
})

// The candidate query below scopes to text/p2p rows, which are always
// campaign-scoped — only social outreach can be org-only (outreach.prisma).
export type SweepableOutreach = Outreach & {
  campaignId: number
  campaign: { organizationSlug: string }
}

// Peerly's report retention, which bounds how far back replies can be read.
export const WIN_REPLY_BACKFILL_RETENTION_DAYS = 90

// Peerly asked for one outstanding report request at a time.
export const WIN_REPLY_BACKFILL_DELAY_BETWEEN_JOBS_MS = 2000

export type WinReplyBackfillSummary = {
  since: Date
  sends: number
  jobsRead: number
  sendsWithoutCapture: number
  messagesFound: number
  messagesWritten: number
  jobs: { outreachId: number; jobId: string; found: number; written: number }[]
  failedJobs: { outreachId: number; jobId: string; error: string }[]
}

const sendAnchorOf = (outreach: Outreach): Date =>
  outreach.date ?? outreach.createdAt

// Padded a day on each side: Peerly evaluates the range in its account
// timezone while these timestamps are server-local, and a boundary
// mismatch would silently drop the job's first or last day of events.
// Anchor on the scheduled send date when it exists — a backdated
// outreach's replies can predate the row's createdAt.
const buildReportWindow = (
  outreach: Outreach,
  now: Date,
): PeerlyReportDateWindow => ({
  startDate: format(
    subDays(sendAnchorOf(outreach), 1),
    PEERLY_REPORT_DATE_FORMAT,
  ),
  endDate: format(addDays(now, 1), PEERLY_REPORT_DATE_FORMAT),
})

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

  // The outreachInboundSweep schedule's worker. Scope: only text/p2p
  // outreaches with both a Peerly job (projectId) and a Peerly list id
  // (phoneListId) — without the list there are no captured recipients to map
  // inbound phones to. Reports export the whole job window per call (no
  // cursoring), so idempotency rides on sourceEventId, not on "since last
  // sweep" bookkeeping, and a retried run reads its jobs again harmlessly.
  // Not fanned out: one job's failure only logs and is read again next pass,
  // and the pass-wide counters are what flag an ingestion gap.
  async sweepInboundEvents(job: JobRun<ScheduleData>): Promise<void> {
    if (!isSweepDeploy()) return
    await this.runInboundSweep(new Date(), job.signal)
  }

  // The outreachOptOutReconcile schedule's worker. Not fanned out, for the
  // same reasons, and because its time budget and ordering are pass-wide.
  async reconcileOptOutFlags(job: JobRun<ScheduleData>): Promise<void> {
    if (!isSweepDeploy()) return
    await this.runOptOutReconcile(new Date(), job.signal)
  }

  private async findCandidates(
    now: Date,
    windowDays: number,
  ): Promise<SweepableOutreach[]> {
    const windowStart = subDays(now, windowDays)
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
    return candidates.map((outreach) => ({
      ...outreach,
      campaignId: outreach.campaignId!,
      campaign: outreach.campaign!,
    }))
  }

  private async runInboundSweep(now: Date, signal: AbortSignal): Promise<void> {
    const candidates = await this.findCandidates(now, INBOUND_SWEEP_WINDOW_DAYS)
    const counters = emptySweepCounters()
    let agedJobsPolled = 0
    const currentHour = getHours(now)

    for (const outreach of candidates) {
      // Each job is read on its own and idempotently, so a run stopped by a
      // deploy leaves the rest for its retry.
      signal.throwIfAborted()
      const sendAnchor = sendAnchorOf(outreach)
      // A pre-scheduled job's Peerly job/list can exist well before its
      // send date — no CDR/response event can exist before the send
      // actually happens, so polling it hourly until then is pure waste.
      if (!isBefore(sendAnchor, now)) {
        counters.jobsSkippedFuture += 1
        continue
      }
      const isAged = isBefore(
        sendAnchor,
        subDays(now, INBOUND_SWEEP_FRESH_WINDOW_DAYS),
      )
      if (isAged && currentHour % INBOUND_SWEEP_AGED_HOUR_INTERVAL !== 0) {
        counters.jobsSkippedAgedCadence += 1
        continue
      }
      try {
        const polled = await this.sweepOutreach(outreach, now, counters)
        if (!polled) {
          counters.jobsWithoutCapture += 1
          continue
        }
        counters.jobsPolled += 1
        if (isAged) {
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
        '[Outreach Inbound] sends past the fresh window produced zero ' +
          'inbound events — possible ingestion gap (a Peerly report ' +
          'format change)',
      )
    }
  }

  // Never-read jobs first (a new send, or one a cut-short pass didn't
  // reach), then the longest-waiting, newest send breaking ties, so a pass
  // that runs out of time leaves behind only the jobs read most recently.
  private async runOptOutReconcile(
    now: Date,
    signal: AbortSignal,
  ): Promise<void> {
    const candidates = await this.findCandidates(
      now,
      OPT_OUT_RECONCILE_WINDOW_DAYS,
    )
    const attempts = await this.client.outreachOptOutReconcile.findMany({
      where: { outreachId: { in: candidates.map(({ id }) => id) } },
    })
    const attemptedAtById = new Map(
      attempts.map(({ outreachId, attemptedAt }) => [outreachId, attemptedAt]),
    )
    const readRecentlyAfter = addMinutes(
      subHours(now, OPT_OUT_RECONCILE_INTERVAL_HOURS),
      OPT_OUT_RECONCILE_INTERVAL_SLACK_MINUTES,
    )
    const counters = emptySweepCounters()
    let jobsSkippedRecent = 0
    let jobsTimedOut = 0
    let jobsDeferred = 0

    const due = candidates.filter((outreach) => {
      if (!isBefore(sendAnchorOf(outreach), now)) {
        counters.jobsSkippedFuture += 1
        return false
      }
      const attemptedAt = attemptedAtById.get(outreach.id)
      if (attemptedAt && isAfter(attemptedAt, readRecentlyAfter)) {
        jobsSkippedRecent += 1
        return false
      }
      return true
    })
    due.sort((a, b) => {
      const aAttemptedAt = attemptedAtById.get(a.id)
      const bAttemptedAt = attemptedAtById.get(b.id)
      const byAttempt =
        aAttemptedAt && bAttemptedAt
          ? compareAsc(aAttemptedAt, bAttemptedAt)
          : Number(Boolean(aAttemptedAt)) - Number(Boolean(bAttemptedAt))
      return byAttempt || compareDesc(sendAnchorOf(a), sendAnchorOf(b))
    })

    await pMap(
      due,
      async (outreach) => {
        signal.throwIfAborted()
        if (
          differenceInMilliseconds(new Date(), now) >=
          OPT_OUT_RECONCILE_BUDGET_MS
        ) {
          jobsDeferred += 1
          return
        }
        try {
          const polled = await this.reconcileOutreachOptOuts(
            outreach,
            now,
            counters,
          )
          if (polled) {
            counters.jobsPolled += 1
          } else {
            counters.jobsWithoutCapture += 1
          }
        } catch (err) {
          const timedOut = err instanceof GatewayTimeoutException
          if (timedOut) {
            jobsTimedOut += 1
          } else {
            counters.jobsFailed += 1
          }
          // Message only: a raw axios error carries the request's auth
          // headers.
          this.logger.warn(
            {
              message: err instanceof Error ? err.message : String(err),
              outreachId: outreach.id,
              jobId: outreach.projectId,
            },
            timedOut
              ? '[Outreach Opt-out Reconcile] report timed out; will retry ' +
                  'once the interval passes'
              : '[Outreach Opt-out Reconcile] job failed; will retry once ' +
                  'the interval passes',
          )
        }
        // Stamped whatever the outcome: a slow report retried every hour
        // would cost Peerly six builds for the one answer.
        await this.client.outreachOptOutReconcile.upsert({
          where: { outreachId: outreach.id },
          create: { outreachId: outreach.id, attemptedAt: now },
          update: { attemptedAt: now },
        })
      },
      { concurrency: OPT_OUT_RECONCILE_CONCURRENCY },
    )

    this.logger.info(
      {
        jobsDue: due.length,
        jobsPolled: counters.jobsPolled,
        jobsFailed: counters.jobsFailed,
        jobsTimedOut,
        jobsDeferred,
        jobsWithoutCapture: counters.jobsWithoutCapture,
        jobsSkippedFuture: counters.jobsSkippedFuture,
        jobsSkippedRecent,
        durationMs: differenceInMilliseconds(new Date(), now),
        optOutsApplied: counters.optOutsApplied,
        skippedDuplicate: counters.skippedDuplicate,
        skippedAlreadyApplied: counters.skippedAlreadyApplied,
        skippedUnmatched: counters.skippedUnmatched,
        skippedNoRow: counters.skippedNoRow,
      },
      '[Outreach Opt-out Reconcile] summary',
    )
    // Expected while no job in the window has been read yet (the table
    // starts empty). Hour after hour, it means reads are falling behind the
    // interval.
    if (jobsDeferred > 0) {
      this.logger.warn(
        { jobsDeferred, jobsDue: due.length },
        '[Outreach Opt-out Reconcile] budget spent; due jobs left for the ' +
          'next pass',
      )
    }
  }

  // Returns false when the outreach has no captured phone list, the same
  // case sweepOutreach skips.
  private async reconcileOutreachOptOuts(
    outreach: SweepableOutreach,
    now: Date,
    counters: SweepCounters,
  ): Promise<boolean> {
    const jobId = outreach.projectId
    if (!jobId) return false
    const phoneToPersonIds = await this.loadPhoneToPersonIds(outreach)
    if (!phoneToPersonIds) return false

    const rows = await this.peerlyJobResults.fetchQuestionResponseRows(
      jobId,
      buildReportWindow(outreach, now),
      { timeoutMs: OPT_OUT_REPORT_TIMEOUT_MS, retry: false },
    )
    const events = this.collectOptOutEvents(
      jobId,
      rows,
      phoneToPersonIds,
      counters,
    )
    await this.applyEvents(outreach, events, now, counters)
    return true
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
    if (!jobId) return false
    const phoneToPersonIds = await this.loadPhoneToPersonIds(outreach)
    if (!phoneToPersonIds) return false

    const cdrRows = await this.peerlyJobResults.fetchInboundCdrRows(
      jobId,
      buildReportWindow(outreach, now),
    )
    const events = this.collectCdrEvents(
      jobId,
      cdrRows,
      phoneToPersonIds,
      counters,
    )
    await this.applyEvents(outreach, events, now, counters)
    counters.messagesWritten += await this.writeReplyMessages(
      this.buildReplyMessages(outreach.id, cdrRows, phoneToPersonIds, now),
    )
    return true
  }

  // scripts/backfill-win-sms-replies.ts: the sweep's message writer over a
  // job the sweep no longer reads (a replaced job's previousJobId, or a send
  // past its window). Writes messages only; the stamps are the sweep's.
  // Null when the outreach has no captured phone list.
  async backfillReplyMessages(
    outreach: SweepableOutreach,
    jobId: string,
    now: Date,
    dryRun: boolean,
  ): Promise<{ messagesFound: number; messagesWritten: number } | null> {
    const phoneToPersonIds = await this.loadPhoneToPersonIds(outreach)
    if (!phoneToPersonIds) return null

    const cdrRows = await this.peerlyJobResults.fetchInboundCdrRows(
      jobId,
      buildReportWindow(outreach, now),
    )
    const messages = this.buildReplyMessages(
      outreach.id,
      cdrRows,
      phoneToPersonIds,
      now,
    )
    return {
      messagesFound: messages.length,
      messagesWritten: dryRun ? 0 : await this.writeReplyMessages(messages),
    }
  }

  // Every Win p2p send inside Peerly's retention, over its current job and
  // the one it replaced (which the sweep never reads). Counts only on a dry
  // run. One failed job is recorded and the rest still run.
  async backfillWinReplies(
    dryRun: boolean,
    signal?: AbortSignal,
  ): Promise<WinReplyBackfillSummary> {
    const now = new Date()
    const since = subDays(now, WIN_REPLY_BACKFILL_RETENTION_DAYS)
    const outreaches = await this.model.findMany({
      where: {
        outreachType: OutreachType.p2p,
        campaignId: { not: null },
        phoneListId: { not: null },
        OR: [{ projectId: { not: null } }, { previousJobId: { not: null } }],
        AND: [
          {
            OR: [
              { date: { gte: since } },
              { date: null, createdAt: { gte: since } },
            ],
          },
        ],
      },
      include: { campaign: { select: { organizationSlug: true } } },
      orderBy: { id: 'asc' },
    })

    const summary: WinReplyBackfillSummary = {
      since,
      sends: outreaches.length,
      jobsRead: 0,
      sendsWithoutCapture: 0,
      messagesFound: 0,
      messagesWritten: 0,
      jobs: [],
      failedJobs: [],
    }
    let first = true

    for (const outreach of outreaches) {
      const { campaign, campaignId } = outreach
      if (campaign === null || campaignId === null) continue
      const jobIds = [outreach.projectId, outreach.previousJobId].filter(
        (jobId): jobId is string => jobId !== null,
      )
      for (const jobId of jobIds) {
        signal?.throwIfAborted()
        if (!first) await delay(WIN_REPLY_BACKFILL_DELAY_BETWEEN_JOBS_MS)
        first = false
        try {
          const result = await this.backfillReplyMessages(
            { ...outreach, campaign, campaignId },
            jobId,
            now,
            dryRun,
          )
          if (result === null) {
            summary.sendsWithoutCapture += 1
            break
          }
          summary.jobsRead += 1
          summary.messagesFound += result.messagesFound
          summary.messagesWritten += result.messagesWritten
          summary.jobs.push({
            outreachId: outreach.id,
            jobId,
            found: result.messagesFound,
            written: result.messagesWritten,
          })
        } catch (err) {
          // Message only: a raw axios error carries the request's auth
          // headers.
          summary.failedJobs.push({
            outreachId: outreach.id,
            jobId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
    return summary
  }

  // The winReplyBackfill job's worker. Idempotent: message ids are uuidv5 of
  // the row and writes skip duplicates. Logs counts and ids only, never
  // reply text.
  async runWinReplyBackfill(job: JobRun<{ dryRun: boolean }>): Promise<void> {
    const { dryRun } = job.data
    const { jobs, failedJobs, since, ...totals } =
      await this.backfillWinReplies(dryRun, job.signal)
    for (const entry of jobs) {
      this.logger.info(entry, '[Outreach Win Reply Backfill] job read')
    }
    this.logger.info(
      {
        dryRun,
        since: since.toISOString(),
        ...totals,
        jobsFailed: failedJobs.length,
      },
      '[Outreach Win Reply Backfill] summary',
    )
    if (failedJobs.length > 0) {
      this.logger.warn(
        { dryRun, failedJobs },
        '[Outreach Win Reply Backfill] jobs failed',
      )
    }
  }

  private async writeReplyMessages(
    messages: Prisma.PollIndividualMessageCreateManyInput[],
  ): Promise<number> {
    if (messages.length === 0) return 0
    const { count } = await this.client.pollIndividualMessage.createMany({
      data: messages,
      skipDuplicates: true,
    })
    return count
  }

  // One message per received row per person on its phone, so a household
  // sharing a number gets the reply on each person, as the stamps do. Only
  // an exact 'received' row: any other Direction may be our own outbound
  // text, which must never read as a reply.
  private buildReplyMessages(
    outreachId: number,
    cdrRows: PeerlyCdrCsvRow[],
    phoneToPersonIds: Map<string, string[]>,
    now: Date,
  ): Prisma.PollIndividualMessageCreateManyInput[] {
    const messages: Prisma.PollIndividualMessageCreateManyInput[] = []
    for (const row of cdrRows) {
      if (row.Direction.trim().toLowerCase() !== PEERLY_CDR_INBOUND_DIRECTION) {
        continue
      }
      const match = matchCdrRow(row, phoneToPersonIds)
      if (!match) continue
      const sentAt = parseReportTimestamp(row.Timestamp) ?? now
      const isOptOut = isOptOutMessage(row.Content)
      for (const personId of match.personIds) {
        messages.push({
          id: uuidv5(
            `${outreachId}:${personId}:${row.Timestamp}:${row.Content}`,
            WIN_REPLY_MESSAGE_NAMESPACE,
          ),
          sender: PollIndividualMessageSender.CONSTITUENT,
          outreachId,
          personId,
          personCellPhone: `+1${match.phoneKey}`,
          sentAt,
          content: row.Content,
          isOptOut,
          electedOfficeId: null,
        })
      }
    }
    return messages
  }

  // Null when there are no captured recipients to map report phones to.
  private async loadPhoneToPersonIds(
    outreach: SweepableOutreach,
  ): Promise<Map<string, string[]> | null> {
    if (!outreach.phoneListId) return null

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
      return null
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
    return phoneToPersonIds
  }

  // Opt-outs come from the reply text itself, under the same event id the
  // backup pass uses for Peerly's own flag, so either source dedupes the
  // other. A stop reply is a reply and an opt-out at once.
  private collectCdrEvents(
    jobId: string,
    inboundRows: PeerlyCdrCsvRow[],
    phoneToPersonIds: Map<string, string[]>,
    counters: SweepCounters,
  ): InboundEvent[] {
    const events: InboundEvent[] = []
    for (const row of inboundRows) {
      // A trailing blank CSV line parses as an all-empty row; it isn't an
      // inbound event.
      if (!row.From && !row.To) continue
      counters.inboundRowsSeen += 1
      const isReceived =
        row.Direction.trim().toLowerCase() === PEERLY_CDR_INBOUND_DIRECTION
      if (!isReceived) {
        counters.unexpectedDirectionRows += 1
      }
      const match = matchCdrRow(row, phoneToPersonIds)
      if (!match) {
        counters.skippedUnmatched += 1
        continue
      }
      const { phoneKey, personIds } = match
      const eventTimestamp = parseReportTimestamp(row.Timestamp)
      events.push({
        sourceEventId: `peerly:${jobId}:${phoneKey}:reply`,
        personIds,
        eventType: 'reply',
        eventTimestamp,
      })
      if (isReceived && isOptOutMessage(row.Content)) {
        events.push({
          sourceEventId: `peerly:${jobId}:${phoneKey}:optout`,
          personIds,
          eventType: 'optout',
          eventTimestamp,
        })
      }
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
    const optoutValues = new Set<string>()
    for (const row of rows) {
      if (!isOptedOut(row.optout)) continue
      counters.inboundRowsSeen += 1
      optoutValues.add(row.optout)
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
    // Once per job, not per row: prod has only ever shown 'True', and now
    // that big jobs' reports succeed a per-row line would run to hundreds of
    // thousands a day. The flag value is not PII, unlike the rest of the row.
    if (optoutValues.size > 0) {
      this.logger.info(
        { jobId, optoutValues: [...optoutValues] },
        '[Outreach Inbound] opt-out flag values observed',
      )
    }
    return events
  }

  private async applyEvents(
    outreach: SweepableOutreach,
    events: InboundEvent[],
    now: Date,
    counters: SweepCounters,
  ): Promise<void> {
    // Export order is undefined, so dedupe keeps the EARLIEST-timestamped
    // event per id — respondedAt is first-write-permanent downstream, and
    // a later reply's timestamp must not win over the actual first reply.
    const eventsById = new Map<string, InboundEvent>()
    for (const event of events) {
      const existing = eventsById.get(event.sourceEventId)
      if (
        !existing ||
        (event.eventTimestamp !== undefined &&
          (existing.eventTimestamp === undefined ||
            event.eventTimestamp < existing.eventTimestamp))
      ) {
        eventsById.set(event.sourceEventId, event)
      }
    }
    const uniqueEvents = [...eventsById.values()]
    // Pre-screen against already-recorded events so a full re-export is
    // mostly a read; the (organizationSlug, sourceEventId) unique index and
    // the null-timestamp guards in applyInboundEvent are the backstop.
    const existingIds = await this.textInteractions.findExistingSourceEventIds(
      outreach.id,
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
