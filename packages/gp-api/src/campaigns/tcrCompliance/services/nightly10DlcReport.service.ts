import { Injectable, NotFoundException } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  differenceInBusinessDays,
  differenceInCalendarDays,
  isBefore,
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
import {
  PEERLY_PROFILE_STATUS_PENDING,
  PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE,
} from '../../../vendors/peerly/services/peerly.const'
import { PeerlyIdentityService } from '../../../vendors/peerly/services/peerlyIdentity.service'
import { wouldBePublishableAfterFallbacks } from '../../../websites/services/websites.service'
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

// Cases 2 and 3b (ENG-10796): James at Peerly agreed we escalate these
// Peerly-side stalls directly into the shared Slack Connect channel once
// past this business-day floor (weekends must not count — Peerly doesn't
// work CV/finalize queues over the weekend either).
const VENDOR_ESCALATION_BUSINESS_DAY_THRESHOLD = 3

// The suffix predicates must be OR'd inside the NOT. Prisma reads a bare
// `NOT: [a, b]` as NOT(a AND b), and no address ends with both suffixes, so
// that form is always true and excludes nobody.
export const reportableCampaign = {
  isPro: true,
  user: {
    NOT: {
      OR: INTERNAL_EMAIL_SUFFIXES.map((suffix) => ({
        email: { endsWith: suffix, mode: Prisma.QueryMode.insensitive },
      })),
    },
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

// Vendor-appropriate content only: identity ID + committee name is enough
// for Peerly to look up the record — no candidate email/phone, no internal
// campaign IDs, no gp-admin links.
const vendorEscalationMessage = ({
  record,
  stateLabel,
  since,
  now,
  ask,
}: {
  record: RecordWithCampaign
  stateLabel: string
  since: Date
  now: Date
  ask: string
}) =>
  `*10DLC vendor escalation*\n` +
  `Peerly identity: ${record.peerlyIdentityId}\n` +
  `Committee: ${record.committeeName}\n` +
  `${stateLabel} since ${formatDate(since, DateFormats.usDate)} ` +
  `(${differenceInBusinessDays(now, since)} business days).\n` +
  `Ask: ${ask}`

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
      agingCvInFlight,
      neverReachedCv,
      profileStalled,
      inReviewStalled,
      waitingToFinalizeStalled,
      deferredDispatchCandidates,
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
          // Split below into the two sections these statuses actually mean.
          // Only APPROVED implies a PIN went out; REQUESTED and IN_REVIEW mean
          // CampaignVerify is still reviewing, and nudging those candidates
          // walked them into a PIN box with no PIN behind it (ENG-10866). A
          // null CV status belongs to the case-1 failure section; VERIFIED is
          // the opposite end (PIN already entered — a stall there is case 3a);
          // REJECTED/WITHDRAWN land in the rejected section.
          peerlyCvStatus: {
            in: [
              PeerlyCvVerificationStatus.APPROVED,
              PeerlyCvVerificationStatus.REQUESTED,
              PeerlyCvVerificationStatus.IN_REVIEW,
            ],
          },
          // Coarse floor only: a record created less than the nudge window
          // ago cannot have been waiting longer than it, so this can never
          // over-exclude. The precise clock is applied per section in code
          // below — the two sections measure different things, and the
          // `updatedAt` this filter used to key off is bumped by *any* write
          // to the row (including the nightly poll's own status write), which
          // silently reset the age.
          createdAt: { lt: subDays(now, AWAITING_PIN_NUDGE_DAYS) },
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
          // An actively billing-blocked record already appears in the
          // billingBlocked section — exclude it here to avoid
          // double-counting it in the stuck total (mirrors case 3a).
          NOT: {
            peerlyBillingBlockedAt: {
              gte: subMinutes(now, PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES),
            },
          },
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
          // An *actively* billing-blocked record (within the cooldown
          // window) already has its own section; listing it here too would
          // double-count it in the stuck total. Records whose block is older
          // than the cooldown are not in that section and must not be
          // excluded here.
          NOT: {
            peerlyBillingBlockedAt: {
              gte: subMinutes(now, PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES),
            },
          },
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
      // Case 2 (ENG-10796): CV stuck IN_REVIEW — CampaignVerify can't reach
      // the election authority. Business-day math can't live in the Prisma
      // where clause, so this fetches every currently-IN_REVIEW candidate and
      // the >3-business-day floor is applied in code below.
      this.model.findMany({
        where: {
          ...proOnly,
          peerlyIdentityId: { not: null },
          // Actively billing-blocked records list under their own section
          // only (mirrors cases 1 and 3a).
          NOT: {
            peerlyBillingBlockedAt: {
              gte: subMinutes(now, PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES),
            },
          },
          status: {
            in: [TcrComplianceStatus.submitted, TcrComplianceStatus.pending],
          },
          peerlyCvStatus: PeerlyCvVerificationStatus.IN_REVIEW,
          // Stamped by the same poll write that sets the status; the guard
          // keeps never-escalatable rows out of the fetch.
          peerlyCvStatusChangedAt: { not: null },
        },
        include: { campaign: true },
      }),
      // Case 3b (ENG-10796): CV VERIFIED but the brand profile is stuck
      // waiting_to_finalize — the CV token is attached and /approve ran, but
      // Peerly's own finalize confirmation never landed.
      this.model.findMany({
        where: {
          ...proOnly,
          peerlyIdentityId: { not: null },
          NOT: {
            peerlyBillingBlockedAt: {
              gte: subMinutes(now, PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES),
            },
          },
          status: {
            in: [TcrComplianceStatus.submitted, TcrComplianceStatus.pending],
          },
          peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
          peerlyProfileStatus: PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE,
          peerlyProfileStatusChangedAt: { not: null },
        },
        include: { campaign: true },
      }),
      // Dispatch deferred (ENG-10859): the kickoff gate leaves kickoffSentAt
      // null when the candidate profile can't pass the publish gate, so
      // these records match no other section (the stuck-submission filter's
      // `kickoffSentAt: { lt: ... }` never matches null). Whether the
      // profile is still incomplete is decided in code below — content
      // lives on the website relation, not in a Prisma-filterable column.
      this.model.findMany({
        where: {
          ...proOnly,
          status: TcrComplianceStatus.submitted,
          peerlyIdentityId: null,
          kickoffSentAt: null,
          createdAt: { lt: subHours(now, STUCK_SUBMISSION_MIN_AGE_HOURS) },
        },
        include: {
          campaign: {
            include: {
              user: true,
              campaignPositions: { include: { topIssue: true } },
              website: true,
            },
          },
        },
        orderBy: { createdAt: Prisma.SortOrder.asc },
      }),
    ])

    // Business-day floor applied in code (see comment above) — restricted to
    // the same in-flight population the queries above already scoped.
    const inReviewToEscalate = inReviewStalled.filter(
      (
        record,
      ): record is RecordWithCampaign & {
        peerlyCvStatusChangedAt: Date
      } =>
        record.peerlyCvStatusChangedAt !== null &&
        differenceInBusinessDays(now, record.peerlyCvStatusChangedAt) >
          VENDOR_ESCALATION_BUSINESS_DAY_THRESHOLD,
    )
    const waitingToFinalizeToEscalate = waitingToFinalizeStalled.filter(
      (
        record,
      ): record is RecordWithCampaign & {
        peerlyProfileStatusChangedAt: Date
      } =>
        record.peerlyProfileStatusChangedAt !== null &&
        differenceInBusinessDays(now, record.peerlyProfileStatusChangedAt) >
          VENDOR_ESCALATION_BUSINESS_DAY_THRESHOLD,
    )

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
      {
        title: '⚠️ Escalated to Peerly: CV IN_REVIEW >3 business days',
        lines: inReviewToEscalate.map(
          (record) =>
            `${campaignRef(record)} — identity ${record.peerlyIdentityId}, ` +
            `IN_REVIEW ${differenceInBusinessDays(now, record.peerlyCvStatusChangedAt)}` +
            ` business days (${
              record.cvInReviewEscalatedAt
                ? `escalated ${formatDate(record.cvInReviewEscalatedAt, DateFormats.usDate)}`
                : 'escalation pending'
            })`,
        ),
      },
      {
        title: '⚠️ Escalated to Peerly: waiting_to_finalize >3 business days',
        lines: waitingToFinalizeToEscalate.map(
          (record) =>
            `${campaignRef(record)} — identity ${record.peerlyIdentityId}, ` +
            `waiting_to_finalize ${differenceInBusinessDays(now, record.peerlyProfileStatusChangedAt)}` +
            ` business days (${
              record.finalizeStalledEscalatedAt
                ? `escalated ${formatDate(record.finalizeStalledEscalatedAt, DateFormats.usDate)}`
                : 'escalation pending'
            })`,
        ),
      },
    ]
    const nudgeCutoff = subDays(now, AWAITING_PIN_NUDGE_DAYS)
    // When the PIN went out: the detection sweep's stamp, else when CV reached
    // APPROVED (Peerly issues the PIN on that transition). Never `updatedAt` —
    // any write to the row bumps it, so an unrelated update would reset a
    // three-week-old wait to "PIN out 0d".
    const pinSentAt = (record: RecordWithCampaign) =>
      record.pinSentDetectedAt ?? record.peerlyCvStatusChangedAt
    // How long the candidate has been waiting with no PIN at all. Measured
    // from the CV submission, not the last status change: REQUESTED ->
    // IN_REVIEW is a transition, not a delivery, and this section exists to
    // surface the total wait. Keying it off any *ChangedAt column would
    // restart the clock every time CampaignVerify moved the record sideways.
    const cvWaitingSince = (record: RecordWithCampaign) =>
      record.peerlySubmissionStartedAt ?? record.createdAt

    // A record carrying neither timestamp gives us no basis for "PIN out Nd".
    // Falling back to createdAt would report the campaign's own age, so a
    // months-old campaign reads as months of PIN delay that never happened —
    // the same class of wrong number the updatedAt clock produced. Drop it
    // from the nudge rather than print an age we can't stand behind.
    const agingAwaitingPin = agingCvInFlight.flatMap((record) => {
      const sentAt = pinSentAt(record)
      return record.peerlyCvStatus === PeerlyCvVerificationStatus.APPROVED &&
        sentAt !== null &&
        isBefore(sentAt, nudgeCutoff)
        ? [{ record, sentAt }]
        : []
    })
    const agingCvUnissued = agingCvInFlight.filter(
      (record) =>
        record.peerlyCvStatus !== PeerlyCvVerificationStatus.APPROVED &&
        isBefore(cvWaitingSince(record), nudgeCutoff),
    )

    const nudgeSection: ReportSection = {
      title: `⏳ Awaiting PIN >${AWAITING_PIN_NUDGE_DAYS}d (candidate nudge)`,
      lines: agingAwaitingPin.map(
        ({ record, sentAt }) =>
          `${campaignRef(record)} — identity ${record.peerlyIdentityId}, ` +
          `PIN out ${differenceInCalendarDays(now, sentAt)}d`,
      ),
    }

    // Deliberately not a nudge: no PIN exists, so contacting the candidate can
    // only push them into a PIN box they cannot satisfy. Waiting on
    // CampaignVerify; IN_REVIEW past the business-day floor escalates to
    // Peerly through its own section.
    const cvUnissuedSection: ReportSection = {
      title:
        `⏳ CampaignVerify still reviewing >${AWAITING_PIN_NUDGE_DAYS}d ` +
        '(no PIN issued — do not nudge)',
      lines: agingCvUnissued.map(
        (record) =>
          `${campaignRef(record)} — identity ${record.peerlyIdentityId}, ` +
          `no PIN issued, waiting ` +
          `${differenceInCalendarDays(now, cvWaitingSince(record))}d ` +
          `(CV ${record.peerlyCvStatus})`,
      ),
    }

    // A record whose user is missing can't be evaluated (or dispatched) — it
    // stays listed rather than silently vanishing. Publishable-but-unclaimed
    // records are excluded: those are the sweep's to dispatch within its next
    // cycle, not a candidate-side stall.
    const deferredDispatch = deferredDispatchCandidates.filter(
      (record) =>
        !record.campaign.user ||
        !wouldBePublishableAfterFallbacks(
          record.campaign.website?.content,
          record.campaign.user,
          record.campaign,
        ),
    )
    // Nudge-style, not counted as stuck: after the dispatch gate shipped this
    // is a candidate-action item (author bio/issues), and the sweep dispatches
    // automatically the moment they do.
    const deferredDispatchSection: ReportSection = {
      title:
        '⏳ Dispatch deferred: candidate profile incomplete (candidate nudge)',
      lines: deferredDispatch.map(
        (record) =>
          `${campaignRef(record)} — submitted ` +
          `${differenceInCalendarDays(now, record.createdAt)}d ago, ` +
          // A missing user is a data-integrity problem, not a candidate
          // action item — label it so staff repair the record instead of
          // chasing the candidate for content.
          (record.campaign.user
            ? 'waiting on a genuine bio/policy issue'
            : 'missing user association (data repair needed)'),
      ),
    }

    const stuckCount = failureSections.reduce(
      (sum, section) => sum + section.lines.length,
      0,
    )
    const populated = [
      ...failureSections,
      deferredDispatchSection,
      nudgeSection,
      cvUnissuedSection,
    ].filter((section) => section.lines.length > 0)

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

    // Runs after the internal report posts — each stalled record pings the
    // shared vendor channel once, not nightly (ENG-10796).
    await this.escalateInReviewStalls(inReviewToEscalate, now)
    await this.escalateWaitingToFinalizeStalls(waitingToFinalizeToEscalate, now)

    this.logger.info(
      {
        reportDate,
        stuckCount,
        awaitingPin: agingAwaitingPin.length,
        cvUnissued: agingCvUnissued.length,
        deferredDispatch: deferredDispatch.length,
      },
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

    // Suppress per-identity Slack alerts on both reads — a Peerly outage
    // during the poll would otherwise page once per record; the report and
    // logs are the surface here.
    const cvStatus =
      await this.peerlyIdentityService.retrieveCampaignVerifyStatus(
        peerlyIdentityId,
        record.campaign,
        { suppressSlackAlert: true },
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
        // Leaving IN_REVIEW is progress — a later re-stall is a new incident
        // and must re-escalate (ENG-10796).
        if (record.peerlyCvStatus === PeerlyCvVerificationStatus.IN_REVIEW) {
          data.cvInReviewEscalatedAt = null
        }
        // Leaving VERIFIED while waiting_to_finalize is also progress — the
        // profile block below is skipped when cvStatus !== VERIFIED, so the
        // claim must be cleared here or a future re-entry into
        // VERIFIED+waiting_to_finalize could never re-escalate.
        if (
          record.peerlyCvStatus === PeerlyCvVerificationStatus.VERIFIED &&
          record.peerlyProfileStatus ===
            PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE
        ) {
          data.finalizeStalledEscalatedAt = null
        }
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
        // A `null` response is an empty-body success or a swallowed API
        // error upstream (`data || null`) — a transient non-answer, so keep
        // the stored value (mirrors the null-CV guard above). The 404 path
        // resolves to `undefined` and IS definitive: the identity is gone,
        // so fall through and clear the stale status.
        if (profileResponse !== null) {
          const profileStatus = profileResponse?.profile?.status ?? null
          if (profileStatus !== record.peerlyProfileStatus) {
            data.peerlyProfileStatus = profileStatus
            data.peerlyProfileStatusChangedAt = new Date()
            // Same reset for case 3b — leaving waiting_to_finalize re-arms
            // the escalation for a future stall.
            if (
              record.peerlyProfileStatus ===
              PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE
            ) {
              data.finalizeStalledEscalatedAt = null
            }
          }
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

  // Once-only claim on cvInReviewEscalatedAt before posting to the shared
  // vendor channel (ENG-10796 case 2), mirroring the pinSentDetectedAt
  // claim/rollback pattern. A failed post rolls the claim back (scoped to
  // the exact timestamp written) so the next nightly run retries.
  private async escalateInReviewStalls(
    records: (RecordWithCampaign & { peerlyCvStatusChangedAt: Date })[],
    now: Date,
  ) {
    for (const record of records) {
      const claimedAt = new Date()
      const claim = await this.model.updateMany({
        where: { id: record.id, cvInReviewEscalatedAt: null },
        data: { cvInReviewEscalatedAt: claimedAt },
      })
      if (claim.count === 0) {
        continue
      }

      const posted = await this.slack.message(
        {
          blocks: [
            mrkdwnSection(
              vendorEscalationMessage({
                record,
                stateLabel: 'Campaign Verify has been `IN_REVIEW`',
                since: record.peerlyCvStatusChangedAt,
                now,
                ask:
                  'Could you confirm Campaign Verify is able to reach the ' +
                  'election authority for this filing, or share a status ' +
                  'update?',
              }),
            ),
          ],
        },
        SlackChannel.sharedGoodpartyPeerly10Dlc,
      )
      if (posted !== undefined) {
        continue
      }

      // If this rollback itself fails, the claim stays set forever with no
      // post ever sent — log loudly so it's visible rather than silently
      // stranding the record outside every future night's claim attempt.
      try {
        await this.model.updateMany({
          where: { id: record.id, cvInReviewEscalatedAt: claimedAt },
          data: { cvInReviewEscalatedAt: null },
        })
        this.logger.error(
          { tcrComplianceId: record.id },
          '[10DLC nightly report] Vendor escalation post failed ' +
            '(CV IN_REVIEW); claim rolled back for retry',
        )
      } catch (err) {
        this.logger.error(
          { err, tcrComplianceId: record.id },
          '[10DLC nightly report] Vendor escalation post failed and the ' +
            'claim rollback also failed (CV IN_REVIEW); record is stuck ' +
            'unescalated until repaired',
        )
      }
    }
  }

  // Same once-only claim/rollback pattern as escalateInReviewStalls, on
  // finalizeStalledEscalatedAt (ENG-10796 case 3b).
  private async escalateWaitingToFinalizeStalls(
    records: (RecordWithCampaign & {
      peerlyProfileStatusChangedAt: Date
    })[],
    now: Date,
  ) {
    for (const record of records) {
      const claimedAt = new Date()
      const claim = await this.model.updateMany({
        where: { id: record.id, finalizeStalledEscalatedAt: null },
        data: { finalizeStalledEscalatedAt: claimedAt },
      })
      if (claim.count === 0) {
        continue
      }

      const posted = await this.slack.message(
        {
          blocks: [
            mrkdwnSection(
              vendorEscalationMessage({
                record,
                stateLabel: 'The brand profile has been `waiting_to_finalize`',
                since: record.peerlyProfileStatusChangedAt,
                now,
                ask:
                  'Could you confirm the finalize step so this brand can ' +
                  'reach MNO review?',
              }),
            ),
          ],
        },
        SlackChannel.sharedGoodpartyPeerly10Dlc,
      )
      if (posted !== undefined) {
        continue
      }

      // See escalateInReviewStalls — guard the rollback itself so a DB
      // failure here doesn't silently strand the record unescalated forever.
      try {
        await this.model.updateMany({
          where: { id: record.id, finalizeStalledEscalatedAt: claimedAt },
          data: { finalizeStalledEscalatedAt: null },
        })
        this.logger.error(
          { tcrComplianceId: record.id },
          '[10DLC nightly report] Vendor escalation post failed ' +
            '(waiting_to_finalize); claim rolled back for retry',
        )
      } catch (err) {
        this.logger.error(
          { err, tcrComplianceId: record.id },
          '[10DLC nightly report] Vendor escalation post failed and the ' +
            'claim rollback also failed (waiting_to_finalize); record is ' +
            'stuck unescalated until repaired',
        )
      }
    }
  }
}
