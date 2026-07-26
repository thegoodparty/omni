import { Injectable, NotFoundException } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  differenceInCalendarDays,
  subDays,
  subHours,
  subMinutes,
} from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { setTimeout as sleep } from 'timers/promises'
import {
  Campaign,
  ExperimentRun,
  Prisma,
  TcrCompliance,
  TcrComplianceStatus,
} from '../../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { QueueProducerService } from '../../../queue/producer/queueProducer.service'
import {
  MessageGroup,
  Nightly10DlcReportMessage,
  QueueType,
} from '../../../queue/queue.types'
import { SlackService } from '../../../vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageBlock,
  SlackMessageType,
} from '../../../vendors/slack/slackService.types'
import {
  DateFormats,
  EASTERN_TIMEZONE,
  formatDate,
} from '../../../shared/util/date.util'
import { PeerlyCvVerificationStatus } from '../../../vendors/peerly/peerly.types'
import { PEERLY_PROFILE_STATUS_PENDING } from '../../../vendors/peerly/services/peerly.const'
import { PeerlyIdentityService } from '../../../vendors/peerly/services/peerlyIdentity.service'
import { PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES } from './campaignTcrCompliance.service'
import { REGISTRANT_STAMPING_UNIVERSAL_FROM } from './complianceState.service'
// Internal staff/test records would page as real incidents — exclude them.
import { INTERNAL_EMAIL_SUFFIXES } from '../../../users/util/users.util'

// A Pro record still `submitted` with no Peerly identity this long after its
// agent kickoff is stuck: every automated path (in-run retries, resume sweep
// to the 5-attempt cap) has long since finished, and nothing else retries a
// terminally FAILED run (campaign 304314 sat unnoticed for 8 days).
const STUCK_SUBMISSION_MIN_AGE_HOURS = 24

// A minted identity whose PIN hasn't been entered after this long is a
// candidate-side stall, not a system failure — reported as a nudge section.
const AWAITING_PIN_NUDGE_DAYS = 7

// Slack hard-rejects a message whose section text exceeds 3000 chars, and a
// rejected post redelivers into the same failure — so truncate by character
// budget (with headroom for the "…and N more" marker), never by row count.
const SECTION_TEXT_BUDGET = 2800

// Spacing between per-identity retrieve_cv calls in the nightly poll. Peerly
// throttles bulk CV retrieval (429/400), so space the reads out rather than
// firing the whole in-flight set at once (mirrors sweepPinDeliveryDetection).
const PEERLY_CV_READ_SPACING_MS = 350

// Per-run ceiling on Peerly reads — see pollPeerlyStatuses for the
// visibility-timeout math this protects.
const POLL_RECORD_CAP = 120

// Case 1 (ENG-10795): an identity minted but its CV never shows a status at
// all after this long is a submission dropped between GoodParty and Peerly —
// our-side pipeline fault, not a candidate-side stall.
const CV_NEVER_REACHED_MIN_AGE_DAYS = 3

// Case 3a (ENG-10795): PIN entered (CV VERIFIED) but the profile is still
// `pending` well past a nightly cycle — verify_pin -> token -> approve
// normally completes in seconds, so this means we never minted/attached the
// CV token or never called /approve. The floor requires the pair to have
// been observed on two consecutive nightly polls, filtering out records
// still mid-PIN-flow. It sits below 24h because `now` is captured before
// the poll stamps `peerlyProfileStatusChangedAt`: a full-day floor would
// leave last night's stamp seconds too young tonight and delay the flag to
// the third night.
const PROFILE_STALL_MIN_AGE_HOURS = 20

const reportableCampaign = {
  isPro: true,
  user: {
    NOT: INTERNAL_EMAIL_SUFFIXES.map((suffix) => ({
      email: { endsWith: suffix, mode: Prisma.QueryMode.insensitive },
    })),
  },
}

type RecordWithCampaign = TcrCompliance & { campaign: Campaign }

type ReportSection = {
  title: string
  lines: string[]
}

const mrkdwnSection = (text: string): SlackMessageBlock => ({
  type: SlackMessageType.SECTION,
  text: { type: SlackMessageType.MRKDWN, text },
})

const sectionToBlock = ({ title, lines }: ReportSection): SlackMessageBlock => {
  const header = `*${title} (${lines.length})*`
  const shown: string[] = []
  let used = header.length
  for (const line of lines) {
    if (used + line.length + 1 > SECTION_TEXT_BUDGET) {
      break
    }
    shown.push(line)
    used += line.length + 1
  }
  const hidden = lines.length - shown.length
  const body = hidden > 0 ? [...shown, `_…and ${hidden} more_`] : shown
  return mrkdwnSection(`${header}\n${body.join('\n')}`)
}

const campaignRef = (record: RecordWithCampaign) =>
  `• ${record.campaign.slug} (campaign ${record.campaignId})`

@Injectable()
export class Nightly10DlcReportService extends createPrismaBase(
  MODELS.TcrCompliance,
) {
  constructor(
    private readonly queueService: QueueProducerService,
    private readonly slack: SlackService,
    private readonly peerlyIdentityService: PeerlyIdentityService,
  ) {
    super()
  }

  // Fixed wall-clock schedule (@Interval would reset on every weekday prod
  // deploy and never elapse at a daily period). Every replica's cron fires;
  // the date-keyed FIFO deduplicationId collapses them to one handled message
  // (weeklyTasksDigest pattern).
  @Cron('0 0 * * *', {
    name: 'nightly10DlcReport',
    timeZone: EASTERN_TIMEZONE,
  })
  async triggerNightlyReport() {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') {
      return
    }
    const reportDate = formatInTimeZone(
      new Date(),
      EASTERN_TIMEZONE,
      DateFormats.isoDate,
    )
    try {
      await this.queueService.sendMessage(
        {
          type: QueueType.NIGHTLY_10DLC_REPORT,
          data: { reportDate },
        },
        MessageGroup.nightly10DlcReport,
        {
          deduplicationId: `nightly10DlcReport-${reportDate}`,
          throwOnError: true,
        },
      )
    } catch (err) {
      this.logger.error(
        { err, reportDate },
        '[10DLC nightly report] Failed to enqueue report message',
      )
    }
  }

  // Returns false (SQS redelivery) when the Slack post fails, so a missed
  // report retries instead of silently skipping the night.
  async handleNightlyReport({
    reportDate,
  }: Nightly10DlcReportMessage): Promise<boolean> {
    const now = new Date()
    const proOnly = { campaign: reportableCampaign }

    // Poll live Peerly state before the section queries below so the case-1
    // and case-3a sections (ENG-10795) read this run's freshly-persisted
    // peerlyCvStatus/peerlyProfileStatus columns, not last night's.
    const pollCandidates = await this.model.findMany({
      where: {
        ...proOnly,
        peerlyIdentityId: { not: null },
        status: {
          in: [TcrComplianceStatus.submitted, TcrComplianceStatus.pending],
        },
      },
      include: { campaign: true },
      // Oldest-touched first so records past the per-run poll cap (see
      // pollPeerlyStatuses) get their turn on a later night.
      orderBy: { updatedAt: Prisma.SortOrder.asc },
    })
    await this.pollPeerlyStatuses(pollCandidates)

    const [
      stuckSubmissions,
      errorRecords,
      rejectedRecords,
      billingBlocked,
      stuckDomains,
      agingAwaitingPin,
      neverReachedCv,
      profileStalled,
    ] = await Promise.all([
      this.model.findMany({
        where: {
          ...proOnly,
          status: TcrComplianceStatus.submitted,
          peerlyIdentityId: null,
          kickoffSentAt: { lt: subHours(now, STUCK_SUBMISSION_MIN_AGE_HOURS) },
        },
        include: { campaign: true },
        orderBy: { kickoffSentAt: Prisma.SortOrder.asc },
      }),
      this.model.findMany({
        where: { ...proOnly, status: TcrComplianceStatus.error },
        include: { campaign: true },
      }),
      this.model.findMany({
        where: { ...proOnly, status: TcrComplianceStatus.rejected },
        include: { campaign: true },
      }),
      this.model.findMany({
        where: {
          ...proOnly,
          peerlyBillingBlockedAt: {
            gte: subMinutes(now, PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES),
          },
        },
        include: { campaign: true },
      }),
      this.client.domain.findMany({
        where: {
          registrantVerifiedAt: null,
          createdAt: { gte: REGISTRANT_STAMPING_UNIVERSAL_FROM },
          website: {
            campaign: {
              ...reportableCampaign,
              tcrCompliance: {
                status: TcrComplianceStatus.submitted,
                peerlyIdentityId: null,
              },
            },
          },
        },
        include: { website: { include: { campaign: true } } },
      }),
      this.model.findMany({
        where: {
          ...proOnly,
          status: TcrComplianceStatus.submitted,
          peerlyIdentityId: { not: null },
          // A null CV status means the submission never reached
          // CampaignVerify — no PIN ever went out, so the record belongs to
          // the case-1 failure section, not this nudge.
          peerlyCvStatus: { not: null },
          OR: [
            {
              pinSentDetectedAt: { lt: subDays(now, AWAITING_PIN_NUDGE_DAYS) },
            },
            {
              pinSentDetectedAt: null,
              updatedAt: { lt: subDays(now, AWAITING_PIN_NUDGE_DAYS) },
            },
          ],
        },
        include: { campaign: true },
      }),
      // Case 1: identity minted, submitted 3+ days ago, live CV status still
      // null. Disjoint from "Submission never completed" above (that section
      // is peerlyIdentityId: null — never even reached Peerly; this one has
      // an identity but an empty CV) — don't merge them.
      this.model.findMany({
        where: {
          ...proOnly,
          status: TcrComplianceStatus.submitted,
          peerlyIdentityId: { not: null },
          peerlyCvStatus: null,
          OR: [
            {
              peerlySubmissionStartedAt: {
                lt: subDays(now, CV_NEVER_REACHED_MIN_AGE_DAYS),
              },
            },
            {
              peerlySubmissionStartedAt: null,
              createdAt: { lt: subDays(now, CV_NEVER_REACHED_MIN_AGE_DAYS) },
            },
          ],
        },
        include: { campaign: true },
      }),
      // Case 3a: CV VERIFIED (PIN entered) but the profile has sat at
      // `pending` since the prior nightly poll — the token/approve step never
      // completed on our side.
      this.model.findMany({
        where: {
          ...proOnly,
          peerlyIdentityId: { not: null },
          // An actively billing-blocked record already has its own section;
          // listing it here too would double-count it in the stuck total.
          peerlyBillingBlockedAt: null,
          status: {
            in: [TcrComplianceStatus.submitted, TcrComplianceStatus.pending],
          },
          peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
          peerlyProfileStatus: PEERLY_PROFILE_STATUS_PENDING,
          peerlyProfileStatusChangedAt: {
            lt: subHours(now, PROFILE_STALL_MIN_AGE_HOURS),
          },
        },
        include: { campaign: true },
      }),
    ])

    const runIds = stuckSubmissions
      .map((record) => record.agenticRunId)
      .filter((runId): runId is string => runId !== null)
    const runs = runIds.length
      ? await this.client.experimentRun.findMany({
          where: { runId: { in: runIds } },
        })
      : []
    const runStatusById = new Map(
      runs.map((run: ExperimentRun) => [run.runId, run.status]),
    )

    const failureSections: ReportSection[] = [
      {
        title: '🛑 Submission never completed (>24h after kickoff)',
        lines: stuckSubmissions.map((record) => {
          const kickedOffAt = record.kickoffSentAt ?? record.createdAt
          const runStatus = record.agenticRunId
            ? (runStatusById.get(record.agenticRunId) ?? 'unknown')
            : null
          return (
            `${campaignRef(record)} — kicked off ` +
            `${differenceInCalendarDays(now, kickedOffAt)}d ago, run ` +
            (record.agenticRunId
              ? `\`${record.agenticRunId}\` (${runStatus})`
              : 'none')
          )
        }),
      },
      {
        title: '🛑 Kickoff rejected (status `error`)',
        lines: errorRecords.map(
          (record) =>
            `${campaignRef(record)} — errored ` +
            `${differenceInCalendarDays(now, record.updatedAt)}d ago`,
        ),
      },
      {
        title: '🛑 Rejected by Peerly/CampaignVerify',
        lines: rejectedRecords.map(
          (record) =>
            `${campaignRef(record)} — rejected ` +
            `${differenceInCalendarDays(now, record.updatedAt)}d ago, ` +
            'needs a data repair',
        ),
      },
      {
        title: '🛑 Peerly billing block active',
        lines: billingBlocked.map(
          (record) =>
            `${campaignRef(record)} — blocked at ` +
            (record.peerlyBillingBlockedAt
              ? formatDate(record.peerlyBillingBlockedAt, DateFormats.usDate)
              : 'unknown'),
        ),
      },
      {
        title: '🛑 Domain purchase never completed',
        lines: stuckDomains.map(
          (domain) =>
            `• ${domain.website.campaign.slug} (campaign ` +
            `${domain.website.campaignId}) — domain ${domain.name} bought ` +
            `${differenceInCalendarDays(now, domain.createdAt)}d ago, never ` +
            'registrant-verified',
        ),
      },
      {
        title:
          '🛑 Never reached CampaignVerify (>3d, likely our submit pipeline)',
        lines: neverReachedCv.map((record) => {
          const submittedAt =
            record.peerlySubmissionStartedAt ?? record.createdAt
          return (
            `${campaignRef(record)} — identity ${record.peerlyIdentityId}, ` +
            `submitted ${differenceInCalendarDays(now, submittedAt)}d ago`
          )
        }),
      },
      {
        title:
          '🛑 PIN verified but CV token/approve never completed (our side)',
        lines: profileStalled.map((record) => {
          const changedAt =
            record.peerlyProfileStatusChangedAt ?? record.updatedAt
          return (
            `${campaignRef(record)} — identity ${record.peerlyIdentityId}, ` +
            `profile pending ${differenceInCalendarDays(now, changedAt)}d`
          )
        }),
      },
    ]
    const nudgeSection: ReportSection = {
      title: `⏳ Awaiting PIN >${AWAITING_PIN_NUDGE_DAYS}d (candidate nudge)`,
      lines: agingAwaitingPin.map(
        (record) =>
          `${campaignRef(record)} — identity ${record.peerlyIdentityId}, ` +
          `PIN out ${differenceInCalendarDays(
            now,
            record.pinSentDetectedAt ?? record.updatedAt,
          )}d`,
      ),
    }

    const stuckCount = failureSections.reduce(
      (sum, section) => sum + section.lines.length,
      0,
    )
    const populated = [...failureSections, nudgeSection].filter(
      (section) => section.lines.length > 0,
    )

    const blocks: SlackMessageBlock[] = [
      {
        type: SlackMessageType.HEADER,
        text: {
          type: SlackMessageType.PLAIN_TEXT,
          text:
            stuckCount > 0
              ? `🚨 10DLC nightly report — ${reportDate}: ${stuckCount} stuck`
              : `✅ 10DLC nightly report — ${reportDate}: no campaigns stuck`,
        },
      },
      ...populated.map(sectionToBlock),
    ]

    if (stuckCount === 0) {
      const [submitted, pending, approved] = await Promise.all([
        this.model.count({
          where: { ...proOnly, status: TcrComplianceStatus.submitted },
        }),
        this.model.count({
          where: { ...proOnly, status: TcrComplianceStatus.pending },
        }),
        this.model.count({
          where: { ...proOnly, status: TcrComplianceStatus.approved },
        }),
      ])
      blocks.push(
        mrkdwnSection(
          `In flight (Pro): ${submitted} submitted · ${pending} pending ` +
            `carrier review · ${approved} approved`,
        ),
      )
    }

    const posted = await this.slack.message(
      { blocks },
      SlackChannel.bot10DlcCompliance,
    )
    if (posted === undefined) {
      this.logger.error(
        { reportDate, stuckCount },
        '[10DLC nightly report] Slack post failed; message will retry',
      )
      return false
    }

    this.logger.info(
      { reportDate, stuckCount, awaitingPin: agingAwaitingPin.length },
      '[10DLC nightly report] Posted',
    )
    return true
  }

  // Poll live Peerly CV + profile status for every in-flight record and
  // persist "how long in this state" (ENG-10793). One record's Peerly failure
  // must not stop the rest of the poll or the report post, so each record is
  // wrapped individually — a thrown error skips the record, keeping its
  // stored values (never overwritten with null on a failed read).
  // Capped so the poll stays inside the SQS visibility timeout (300s,
  // deploy/index.ts): 350ms spacing + ~500ms Peerly latency ≈ 850ms/record,
  // so 120 records ≈ 100s. An uncapped backlog would outlive the timeout,
  // SQS would redeliver mid-run, and the duplicate consumer's writes would
  // race this one's (the FIFO deduplicationId only covers the enqueue).
  // Oldest records poll first (query orders by updatedAt asc), so records
  // past the cap get their turn on a later night.
  private async pollPeerlyStatuses(records: RecordWithCampaign[]) {
    const capped = records.slice(0, POLL_RECORD_CAP)
    if (records.length > POLL_RECORD_CAP) {
      this.logger.warn(
        { total: records.length, polled: POLL_RECORD_CAP },
        '[10DLC nightly report] In-flight backlog exceeds per-run poll cap',
      )
    }
    for (const record of capped) {
      try {
        await this.pollRecordStatus(record)
      } catch (err) {
        this.logger.error(
          { err, tcrComplianceId: record.id },
          '[10DLC nightly report] Peerly status poll failed for record',
        )
      }
      await sleep(PEERLY_CV_READ_SPACING_MS)
    }
  }

  private async pollRecordStatus(record: RecordWithCampaign) {
    const { peerlyIdentityId } = record
    if (!peerlyIdentityId) {
      return
    }

    const cvStatus =
      await this.peerlyIdentityService.retrieveCampaignVerifyStatus(
        peerlyIdentityId,
        record.campaign,
      )

    const data: Prisma.TcrComplianceUpdateInput = {}
    if (cvStatus !== record.peerlyCvStatus) {
      // A Peerly "no CV request" null after a real status was already
      // observed is not authoritative (the CV request may have been cleaned
      // up on Peerly's side) — erasing history here would flip the record
      // into the case-1 "never reached CV" section.
      if (cvStatus !== null || record.peerlyCvStatus === null) {
        data.peerlyCvStatus = cvStatus
        data.peerlyCvStatusChangedAt = new Date()
      }
    }

    // Only VERIFIED warrants the extra getProfile read — that's the signal
    // case 3a cares about (PIN entered but token/approve never completed).
    if (cvStatus === PeerlyCvVerificationStatus.VERIFIED) {
      try {
        // A 404 (NotFoundException) means the identity is gone on Peerly's
        // side — a definitive answer, not a failed read. Clear the stale
        // profile status rather than preserving it, or case 3a would flag
        // the record forever.
        const profileResponse = await this.peerlyIdentityService
          .getIdentityProfile(peerlyIdentityId, record.campaign, {
            suppressSlackAlert: true,
          })
          .catch((err: unknown) => {
            if (err instanceof NotFoundException) {
              return undefined
            }
            throw err
          })
        const profileStatus = profileResponse?.profile?.status ?? null
        if (profileStatus !== record.peerlyProfileStatus) {
          data.peerlyProfileStatus = profileStatus
          data.peerlyProfileStatusChangedAt = new Date()
        }
      } catch (err) {
        // A failed profile read must not discard the CV observation already
        // staged in `data` — persist it and leave the profile fields for
        // the next night's poll.
        this.logger.error(
          { err, tcrComplianceId: record.id },
          '[10DLC nightly report] Profile read failed; keeping stored value',
        )
      }
    }

    // Unchanged values must not touch the row at all — the awaiting-PIN
    // report section keys off updatedAt, so a no-op poll can't bump it.
    if (Object.keys(data).length === 0) {
      return
    }
    await this.model.update({ where: { id: record.id }, data })
  }
}
