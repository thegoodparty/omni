import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  differenceInCalendarDays,
  subDays,
  subHours,
  subMinutes,
} from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
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
import { PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES } from './campaignTcrCompliance.service'
import { REGISTRANT_STAMPING_UNIVERSAL_FROM } from './complianceState.service'

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
    const proOnly = { campaign: { isPro: true } }

    const [
      stuckSubmissions,
      errorRecords,
      rejectedRecords,
      billingBlocked,
      stuckDomains,
      agingAwaitingPin,
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
              isPro: true,
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
}
