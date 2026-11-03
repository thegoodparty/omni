import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addHours } from 'date-fns'
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

// Every 15 minutes: the daily wave cron is too slow for a one-hour cut-off.
// No CronLockService: the `updateMany where needsHumanAt = null` below elects
// one winner per row, so overlapping runs and replicas post once.
const OVERDUE_SWEEP_CRON = '8,23,38,53 * * * *'
export const OUTREACH_HANDOFF_OVERDUE_JOB = 'outreachHandoffOverdueSweep'
export const HANDOFF_OVERDUE_REASON = 'overdue'
// A send still `queued` this close to its send time has not been scheduled in
// Scale to Win, so a person has to take it.
const OVERDUE_LEAD_HOURS = 1

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
   * Flags to a person every agent row still `queued` close to its send time,
   * and counts the rows that need one. Returns the outreach ids flagged.
   */
  async markOverdue(now: Date): Promise<number[]> {
    const due = await this.model.findMany({
      where: {
        handler: OutreachHandoffHandler.agent,
        status: OutreachHandoffStatus.queued,
        needsHumanAt: null,
        sendAt: { lte: addHours(now, OVERDUE_LEAD_HOURS) },
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
        // A person can still act on a row until its send time; after that it
        // is history.
        where: {
          status: OutreachHandoffStatus.queued,
          needsHumanAt: { not: null },
          sendAt: { gt: now },
        },
      }),
    )
    recordManagedPanelHandoffAlarm(
      'queued_past_due',
      await this.model.count({
        where: {
          handler: OutreachHandoffHandler.agent,
          status: OutreachHandoffStatus.queued,
          sendAt: { lt: now },
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
              text: 'Text wave not scheduled, needs a person',
              emoji: true,
            },
          },
          {
            type: SlackMessageType.SECTION,
            text: {
              type: SlackMessageType.MRKDWN,
              text:
                'This send was still not scheduled an hour before it was due. ' +
                'Schedule it in Scale to Win by hand.\n' +
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
