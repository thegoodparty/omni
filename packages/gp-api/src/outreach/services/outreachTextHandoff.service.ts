import { randomBytes } from 'crypto'
import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addHours, addMinutes, subMinutes } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import {
  AgentHandoffClaimResponse,
  AgentHandoffItem,
} from '@goodparty_org/contracts'
import {
  ManagedCivicPanelStatus,
  OutreachHandoffHandler,
  OutreachHandoffStatus,
  Prisma,
} from '@/generated/prisma'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { getUserFullName } from '@/users/util/users.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageType,
} from '@/vendors/slack/slackService.types'
import { recordManagedPanelHandoffAlarm } from '../observability/managedPanelHandoff.metrics'
import {
  resolveBucket,
  resolveSendKeyPrefix,
} from '../util/outreachTextCsvLocation.util'

export const HANDOFF_CLAIM_TTL_MINUTES = 20
export const HANDOFF_CSV_URL_TTL_SECONDS = 15 * 60
// Scheduling needs the slot to still be ahead of the swarm's next poll.
const SCHEDULE_MIN_LEAD_MINUTES = 120
const FIRST_SEND_SEQ = 1

// Every 15 minutes: the daily wave cron is too slow for a one-hour cut-off.
// No CronLockService: the `updateMany where status = queued` below elects one
// winner per row, so overlapping runs and replicas post once.
const OVERDUE_SWEEP_CRON = '8,23,38,53 * * * *'
export const OUTREACH_HANDOFF_OVERDUE_JOB = 'outreachHandoffOverdueSweep'
export const HANDOFF_OVERDUE_REASON = 'overdue'
// An agent that has not claimed a send this close to its send time is not
// going to, so a person has to take it.
const OVERDUE_LEAD_HOURS = 1

// Dev is where the metrics must show first and prod is what they protect. Not
// previews: every PR stack would post the same rows at once.
const OVERDUE_DEPLOY_ENVIRONMENTS = new Set(['dev', 'prod'])

const handoffInclude = {
  outreach: {
    select: {
      message: true,
      organizationSlug: true,
      managedPanelWave: { select: { wave: true } },
      _count: { select: { textRecipients: true } },
    },
  },
} satisfies Prisma.OutreachTextHandoffInclude

@Injectable()
export class OutreachTextHandoffService extends createPrismaBase(
  MODELS.OutreachTextHandoff,
) {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly s3: S3Service,
    private readonly slack: SlackService,
  ) {
    super()
  }

  // The swarm's whole work queue. `claim` filters by the same predicate, so
  // a row that has fallen out of the list cannot be claimed either.
  private dueWhere(now: Date): Prisma.OutreachTextHandoffWhereInput {
    return {
      handler: OutreachHandoffHandler.agent,
      needsHumanAt: null,
      outreach: { managedPanelWave: { isNot: null } },
      OR: [
        {
          status: OutreachHandoffStatus.queued,
          sendAt: { gt: addMinutes(now, SCHEDULE_MIN_LEAD_MINUTES) },
          outreach: {
            managedPanelWave: {
              enrollment: { status: ManagedCivicPanelStatus.building },
            },
          },
        },
        { status: OutreachHandoffStatus.built, mode: 'shadow' },
        {
          status: OutreachHandoffStatus.scheduled,
          repliesDueAt: { lte: now },
          repliesSubmittedAt: null,
        },
      ],
    }
  }

  private unclaimedWhere(now: Date): Prisma.OutreachTextHandoffWhereInput {
    return {
      OR: [
        { claimedAt: null },
        { claimedAt: { lt: subMinutes(now, HANDOFF_CLAIM_TTL_MINUTES) } },
      ],
    }
  }

  async listDue(now: Date): Promise<AgentHandoffItem[]> {
    const rows = await this.model.findMany({
      where: { AND: [this.dueWhere(now), this.unclaimedWhere(now)] },
      include: handoffInclude,
      orderBy: { sendAt: 'asc' },
    })

    return Promise.all(
      rows.map(async (row): Promise<AgentHandoffItem> => {
        const { outreach } = row
        const organization = outreach.organizationSlug
          ? await this.client.organization.findUnique({
              where: { slug: outreach.organizationSlug },
              include: { owner: true },
            })
          : null
        const serve = organization
          ? await this.organizations.resolveServeContext(organization)
          : null
        const city = serve?.l2DistrictName
          ? OrganizationsService.extractCityFromDistrictName(
              serve.l2DistrictName,
            )
          : null
        const name = organization ? getUserFullName(organization.owner) : ''
        const wave = outreach.managedPanelWave?.wave ?? 0
        const action =
          row.status === OutreachHandoffStatus.queued
            ? 'schedule'
            : row.status === OutreachHandoffStatus.built
              ? 'confirm_scheduled'
              : 'export_replies'

        return {
          outreachId: row.outreachId,
          action,
          mode: row.mode === 'auto' ? 'auto' : 'shadow',
          wave,
          official: { name, city, state: serve?.state ?? '' },
          message: outreach.message ?? '',
          recipientCount: outreach._count.textRecipients,
          sendAt: row.sendAt.toISOString(),
          timeZone: row.timeZone,
          campaignName: `[Serve] Civic ${[name, city ?? serve?.state]
            .filter(Boolean)
            .join(' ')} W${wave} #${row.outreachId}`,
          vendorCampaignName: row.vendorCampaignName,
          repliesDueAt: row.repliesDueAt?.toISOString() ?? null,
        }
      }),
    )
  }

  async claim(
    outreachId: number,
    now: Date,
  ): Promise<AgentHandoffClaimResponse> {
    const { count } = await this.model.updateMany({
      where: {
        AND: [{ outreachId }, this.dueWhere(now), this.unclaimedWhere(now)],
      },
      data: {
        claimedAt: now,
        claimToken: randomBytes(32).toString('base64url'),
      },
    })

    if (count === 0) {
      const exists = await this.model.findUnique({
        where: { outreachId },
        select: { id: true },
      })
      if (!exists) {
        throw new NotFoundException(`No hand-off for outreach ${outreachId}`)
      }
      throw new ConflictException(
        `Hand-off for outreach ${outreachId} is claimed, not due, or needs a person`,
      )
    }

    const row = await this.model.findUniqueOrThrow({ where: { outreachId } })
    const claimedAt = row.claimedAt ?? now
    const recipientsCsvUrl = await this.s3.getSignedUrlForViewing(
      resolveBucket(),
      `${resolveSendKeyPrefix()}/${outreachId}-${FIRST_SEND_SEQ}.csv`,
      { expiresIn: HANDOFF_CSV_URL_TTL_SECONDS },
    )

    return {
      claimToken: row.claimToken ?? '',
      recipientsCsvUrl,
      claimExpiresAt: addMinutes(
        claimedAt,
        HANDOFF_CLAIM_TTL_MINUTES,
      ).toISOString(),
    }
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
   * Hands back to a person every agent row nobody claimed in time, and counts
   * the rows that need one. Returns the outreach ids moved to `needs_human`.
   */
  async markOverdue(now: Date): Promise<number[]> {
    const due = await this.model.findMany({
      where: {
        handler: OutreachHandoffHandler.agent,
        status: OutreachHandoffStatus.queued,
        ...this.unclaimedWhere(now),
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
          ...this.unclaimedWhere(now),
        },
        data: {
          status: OutreachHandoffStatus.needs_human,
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
        // is history, and nothing in gp-api moves it out of needs_human.
        where: {
          status: OutreachHandoffStatus.needs_human,
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
              text: 'Text wave not claimed, needs a person',
              emoji: true,
            },
          },
          {
            type: SlackMessageType.SECTION,
            text: {
              type: SlackMessageType.MRKDWN,
              text:
                'No agent claimed this send an hour before it was due. ' +
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
