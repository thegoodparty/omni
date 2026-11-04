import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subHours } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import {
  OutreachHandoffHandler,
  OutreachHandoffStatus,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { getUserFullName } from '@/users/util/users.util'
import { SlackService } from '@/vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageType,
} from '@/vendors/slack/slackService.types'
import { recordManagedPanelHandoffAlarm } from '../observability/managedPanelHandoff.metrics'

// Every 15 minutes, so a missed export is flagged within the hour.
// No CronLockService: the `updateMany where needsHumanAt = null` below elects
// one winner per row, so overlapping runs and replicas post once.
const OVERDUE_SWEEP_CRON = '8,23,38,53 * * * *'
export const OUTREACH_HANDOFF_OVERDUE_JOB = 'outreachHandoffOverdueSweep'
export const HANDOFF_OVERDUE_REASON = 'overdue'
// gp-api never hears that a wave was scheduled, only that its replies landed.
// So the only overdue signal is no replies by the end of the 48-hour reply
// window plus a few hours for the swarm to export and upload them.
const OVERDUE_AFTER_SEND_HOURS = 48 + 6

// Dev is where the metrics must show first and prod is what they protect. Not
// previews: every PR stack would post the same rows at once.
const OVERDUE_DEPLOY_ENVIRONMENTS = new Set(['dev', 'prod'])

@Injectable()
export class OutreachTextHandoffService extends createPrismaBase(
  MODELS.OutreachTextHandoff,
) {
  constructor(private readonly slack: SlackService) {
    super()
  }

  @Cron(OVERDUE_SWEEP_CRON, {
    name: OUTREACH_HANDOFF_OVERDUE_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepOverdue(): Promise<void> {
    if (
      !OVERDUE_DEPLOY_ENVIRONMENTS.has(
        process.env.OTEL_SERVICE_ENVIRONMENT ?? '',
      )
    ) {
      return
    }
    try {
      await this.markOverdue(new Date())
    } catch (err) {
      this.logger.error({ err }, 'Overdue hand-off sweep failed')
    }
  }

  /**
   * Flags to a person every agent row with no replies well past its reply
   * window, and counts the rows that need one. Returns the outreach ids flagged.
   */
  async markOverdue(now: Date): Promise<number[]> {
    const due = await this.model.findMany({
      where: {
        handler: OutreachHandoffHandler.agent,
        status: OutreachHandoffStatus.queued,
        needsHumanAt: null,
        sendAt: { lte: subHours(now, OVERDUE_AFTER_SEND_HOURS) },
      },
      select: { id: true, outreachId: true },
    })

    const moved: number[] = []
    for (const { id, outreachId } of due) {
      const claimed = await this.model.updateMany({
        where: {
          id,
          status: OutreachHandoffStatus.queued,
          needsHumanAt: null,
        },
        data: {
          needsHumanAt: now,
          needsHumanReason: HANDOFF_OVERDUE_REASON,
        },
      })
      if (claimed.count === 0) continue
      moved.push(outreachId)
      try {
        await this.announceOverdue(id)
      } catch (err) {
        this.logger.error({ err, handoffId: id }, 'Overdue notice failed')
      }
    }

    recordManagedPanelHandoffAlarm(
      'needs_human',
      await this.model.count({
        where: {
          status: OutreachHandoffStatus.queued,
          needsHumanAt: { not: null },
        },
      }),
    )
    return moved
  }

  private async announceOverdue(id: string): Promise<void> {
    const row = await this.model.findUniqueOrThrow({
      where: { id },
      select: {
        outreachId: true,
        sendAt: true,
        timeZone: true,
        outreach: {
          select: {
            managedPanelWave: { select: { wave: true } },
            organization: {
              select: {
                owner: true,
              },
            },
          },
        },
      },
    })
    const { owner } = row.outreach.organization ?? {}
    const official = (owner && getUserFullName(owner)) || 'Unknown'
    const wave = row.outreach.managedPanelWave?.wave
    const sendTime = formatInTimeZone(
      row.sendAt,
      row.timeZone,
      'EEE MMM d, h:mm a zzz',
    )

    await this.slack.message(
      {
        blocks: [
          {
            type: SlackMessageType.HEADER,
            text: {
              type: SlackMessageType.PLAIN_TEXT,
              text: 'Text wave replies missing, needs a person',
              emoji: true,
            },
          },
          {
            type: SlackMessageType.SECTION,
            text: {
              type: SlackMessageType.MRKDWN,
              text:
                'No replies have come in for this send. Check it was sent in ' +
                'Scale to Win, then export the replies and upload them in ' +
                'gp-admin.\n' +
                `• Official: ${official}\n` +
                `• Outreach: ${row.outreachId}\n` +
                `• Wave: ${wave ?? 'n/a'}\n` +
                `• Send time: ${sendTime}`,
            },
          },
        ],
      },
      SlackChannel.botTevynApi,
    )
  }
}
