import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subHours } from 'date-fns'
import { CronLockService } from '@/cron/services/cronLock.service'
import {
  OutreachFunding,
  OutreachStatus,
  OutreachType,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { SlackService } from '@/vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageType,
} from '@/vendors/slack/slackService.types'
import { recordManagedPanelFundingAlarm } from '../observability/managedPanelFunding.metrics'

const RECONCILE_CRON = '47 6 * * *'
export const MANAGED_PANEL_FUNDING_RECONCILE_JOB =
  'managedPanelFundingReconcile'
const WINDOW_HOURS = 24
// A claimed pilot wave is handed off within seconds of its enqueue; one still
// `pending` this long lost its queue message and will never send on its own.
const STUCK_PILOT_HOURS = 4

// Prod is what the job protects, and dev is where a mismatch shows up first.
// Not previews: every PR stack would post the same finding at once.
const RECONCILE_DEPLOY_ENVIRONMENTS = new Set(['dev', 'prod'])

// The `serve-managed-panel-funding-mismatch` alert message tells the
// responder to search for this line. Change both together.
export const FUNDING_MISMATCH_LOG =
  'CRITICAL managed panel funding: send past pending with no funding'

// Every status a send reaches once it has been claimed for sending.
const CLAIMED_STATUSES = [
  OutreachStatus.pending,
  OutreachStatus.approved,
  OutreachStatus.paid,
  OutreachStatus.in_progress,
  OutreachStatus.completed,
  OutreachStatus.failed,
]

export type FundingMismatch = {
  outreachId: number
  sendSeq: number
  organizationSlug: string | null
  status: OutreachStatus
  // unfunded: no paid checkout and no valid managed wave. stuck: a valid
  // pilot wave claimed hours ago that never reached the delivery layer.
  problem: 'unfunded' | 'stuck'
}

/**
 * The daily backstop on free sends. Every Serve text or poll send that moved
 * past `pending_payment` in the last day must hold a paid checkout session or
 * be a managed civic panel wave of its own organization funded by the pilot.
 * Anything else is a send that skipped payment, and raises the alarm. Read
 * only: it never changes a row.
 */
@Injectable()
export class ManagedPanelFundingReconcileService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(
    private readonly cronLock: CronLockService,
    private readonly slack: SlackService,
  ) {
    super()
  }

  @Cron(RECONCILE_CRON, {
    name: MANAGED_PANEL_FUNDING_RECONCILE_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async reconcileDaily(): Promise<void> {
    if (
      !RECONCILE_DEPLOY_ENVIRONMENTS.has(
        process.env.OTEL_SERVICE_ENVIRONMENT ?? '',
      )
    ) {
      return
    }
    const now = new Date()
    if (
      !(await this.cronLock.tryClaimDailyRun(
        MANAGED_PANEL_FUNDING_RECONCILE_JOB,
        now,
      ))
    ) {
      return
    }
    try {
      await this.reconcile(now)
    } finally {
      await this.cronLock.markCompleted(
        MANAGED_PANEL_FUNDING_RECONCILE_JOB,
        now,
      )
    }
  }

  async reconcile(now: Date = new Date()): Promise<FundingMismatch[]> {
    const since = subHours(now, WINDOW_HOURS)

    const unpaidSends = await this.model.findMany({
      where: {
        campaignId: null,
        outreachType: { in: [OutreachType.text, OutreachType.poll] },
        status: { in: CLAIMED_STATUSES },
        updatedAt: { gte: since },
        stripeCheckoutSessionId: null,
      },
      select: {
        id: true,
        organizationSlug: true,
        outreachType: true,
        status: true,
        fundedBy: true,
        managedPanelWave: {
          select: { enrollment: { select: { organizationSlug: true } } },
        },
      },
    })
    const stuckPilotSends = await this.model.findMany({
      where: {
        fundedBy: OutreachFunding.goodparty_pilot,
        status: OutreachStatus.pending,
        updatedAt: { lt: subHours(now, STUCK_PILOT_HOURS) },
      },
      select: { id: true, organizationSlug: true },
    })
    const unpaidExpansions = await this.client.outreachPollExpansion.findMany({
      where: {
        status: { in: CLAIMED_STATUSES },
        stripeCheckoutSessionId: null,
        OR: [{ createdAt: { gte: since } }, { approvedAt: { gte: since } }],
      },
      select: {
        outreachId: true,
        sendSeq: true,
        status: true,
        poll: { select: { outreach: { select: { organizationSlug: true } } } },
      },
    })

    const mismatches: FundingMismatch[] = [
      ...unpaidSends
        .filter(
          (row) =>
            !(
              row.fundedBy === OutreachFunding.goodparty_pilot &&
              row.outreachType === OutreachType.text &&
              row.organizationSlug !== null &&
              row.managedPanelWave?.enrollment.organizationSlug ===
                row.organizationSlug
            ),
        )
        .map((row) => ({
          outreachId: row.id,
          sendSeq: 1,
          organizationSlug: row.organizationSlug,
          status: row.status ?? OutreachStatus.pending,
          problem: 'unfunded' as const,
        })),
      ...stuckPilotSends.map((row) => ({
        outreachId: row.id,
        sendSeq: 1,
        organizationSlug: row.organizationSlug,
        status: OutreachStatus.pending,
        problem: 'stuck' as const,
      })),
      ...unpaidExpansions.map((expansion) => ({
        outreachId: expansion.outreachId,
        sendSeq: expansion.sendSeq,
        organizationSlug: expansion.poll.outreach.organizationSlug,
        status: expansion.status,
        problem: 'unfunded' as const,
      })),
    ]

    if (mismatches.length === 0) {
      this.logger.info(
        { since, checked: unpaidSends.length + unpaidExpansions.length },
        'Managed panel funding reconciled: every unpaid send is a valid ' +
          'managed wave',
      )
      return mismatches
    }

    recordManagedPanelFundingAlarm('reconcile_mismatch', mismatches.length)
    this.logger.error({ since, mismatches }, FUNDING_MISMATCH_LOG)
    await this.notify(mismatches)
    return mismatches
  }

  private async notify(mismatches: FundingMismatch[]): Promise<void> {
    try {
      await this.slack.message(
        {
          blocks: [
            {
              type: SlackMessageType.HEADER,
              text: {
                type: SlackMessageType.PLAIN_TEXT,
                text: 'Text sends with no funding, or stuck pilot waves',
                emoji: true,
              },
            },
            {
              type: SlackMessageType.SECTION,
              text: {
                type: SlackMessageType.MRKDWN,
                text: [
                  'Unfunded: moved past checkout in the last day with ' +
                    'neither a paid checkout nor a managed civic panel wave. ' +
                    'Stuck: a pilot wave still waiting to send after ' +
                    `${STUCK_PILOT_HOURS} hours; re-run its claim to enqueue it.`,
                  ...mismatches.map(
                    (m) =>
                      `• Outreach ${m.outreachId}, send ${m.sendSeq} ` +
                      `(${m.organizationSlug ?? 'no org'}, ${m.status}, ` +
                      `${m.problem})`,
                  ),
                ].join('\n'),
              },
            },
          ],
        },
        SlackChannel.botTevynApi,
      )
    } catch (err) {
      this.logger.error({ err }, 'Funding mismatch notice failed')
    }
  }
}
