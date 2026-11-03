import { randomBytes } from 'crypto'
import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { addDays, addMinutes, differenceInHours, subMinutes } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import {
  AGENT_AUDIENCE_SHORTFALL_TOLERANCE,
  AgentHandoffClaimResponse,
  AgentHandoffItem,
  AgentHandoffReport,
  AgentHandoffReportResponse,
  OutreachResultsParseReport,
  OutreachResultsUploadRequest,
} from '@goodparty_org/contracts'
import {
  ManagedCivicPanelStatus,
  OutreachHandoffHandler,
  OutreachHandoffStatus,
  Prisma,
} from '@/generated/prisma'
import { AnalyticsService } from '@/analytics/analytics.service'
import { MANAGED_WAVE_REPLY_DAYS } from '@/managedPanelWaves/managedPanelWaveJob.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { trackForOffice } from '@/priorities/util/priorityAnalytics.util'
import { EVENTS } from '@/vendors/segment/segment.types'
import { SlackService } from '@/vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageType,
} from '@/vendors/slack/slackService.types'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { getUserFullName } from '@/users/util/users.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  resolveBucket,
  resolveSendKeyPrefix,
} from '../util/outreachTextCsvLocation.util'
import { OutreachResultsAdminService } from './outreachResultsAdmin.service'

export const HANDOFF_CLAIM_TTL_MINUTES = 20
export const HANDOFF_CSV_URL_TTL_SECONDS = 15 * 60
// Scheduling needs the slot to still be ahead of the swarm's next poll.
const SCHEDULE_MIN_LEAD_MINUTES = 120
const FIRST_SEND_SEQ = 1

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

const reportInclude = {
  outreach: {
    select: {
      managedPanelWaveId: true,
      organizationSlug: true,
      scheduledLocalDate: true,
      textCount: true,
      managedPanelWave: {
        select: { wave: true, steeredToward: true, createdAt: true },
      },
      _count: { select: { textRecipients: true } },
    },
  },
} satisfies Prisma.OutreachTextHandoffInclude

type ReportRow = Prisma.OutreachTextHandoffGetPayload<{
  include: typeof reportInclude
}>

@Injectable()
export class OutreachTextHandoffService extends createPrismaBase(
  MODELS.OutreachTextHandoff,
) {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly s3: S3Service,
    private readonly slack: SlackService,
    private readonly analytics: AnalyticsService,
    private readonly results: OutreachResultsAdminService,
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

  async report(
    outreachId: number,
    report: AgentHandoffReport,
    now: Date,
  ): Promise<AgentHandoffReportResponse> {
    const row = await this.loadAgentRow(outreachId)

    if (row.claimToken !== report.claimToken) {
      // Every report clears the token, so a retry of one that already landed
      // finds it null. Answer it from the row; any other mismatch is a stale
      // or foreign claim.
      if (row.claimToken === null && this.isRecorded(row, report)) {
        return this.toReportResponse(row)
      }
      throw new ConflictException(
        `The claim on hand-off ${outreachId} is no longer yours`,
      )
    }

    if (report.status === 'needs_human') {
      const reason = `${report.step}: ${report.reason}`
      await this.settle(outreachId, report.claimToken, {
        status: OutreachHandoffStatus.needs_human,
        needsHumanAt: now,
        needsHumanReason: reason,
      })
      this.track(row, [
        [
          EVENTS.Contacts.CivicPanelWaveErrored,
          {
            wave: row.outreach.managedPanelWave?.wave,
            step: report.step,
            reason,
          },
        ],
      ])
      await this.alert(outreachId, reason)
    } else if (report.status === 'built') {
      await this.settle(
        outreachId,
        report.claimToken,
        {
          status: OutreachHandoffStatus.built,
          vendorCampaignName: report.vendorCampaignName,
          sendingNumber: report.sendingNumber,
          audienceCount: report.audienceCount,
        },
        [OutreachHandoffStatus.queued],
      )
    } else {
      this.assertAudience(row, report.audienceCount)
      const scheduledFor = new Date(report.scheduledFor)
      const repliesDueAt = addDays(scheduledFor, MANAGED_WAVE_REPLY_DAYS)
      await this.client.$transaction(async (tx) => {
        const { count } = await tx.outreachTextHandoff.updateMany({
          where: {
            outreachId,
            claimToken: report.claimToken,
            status: {
              in: [OutreachHandoffStatus.queued, OutreachHandoffStatus.built],
            },
          },
          data: {
            status: OutreachHandoffStatus.scheduled,
            vendorCampaignName: report.vendorCampaignName,
            sendingNumber: report.sendingNumber,
            audienceCount: report.audienceCount,
            scheduledAt: now,
            repliesDueAt,
            claimedAt: null,
            claimToken: null,
          },
        })
        if (count === 0) throw this.staleClaim(outreachId)
        const { managedPanelWaveId } = row.outreach
        if (managedPanelWaveId) {
          await tx.managedPanelWave.updateMany({
            where: { id: managedPanelWaveId, replyWindowEndsAt: null },
            data: { replyWindowEndsAt: repliesDueAt },
          })
        }
      })
      const { outreach } = row
      this.track(row, [
        [
          EVENTS.Contacts.CivicPanelWaveSent,
          {
            wave: outreach.managedPanelWave?.wave,
            texts: outreach.textCount ?? 0,
            sendDate:
              outreach.scheduledLocalDate ??
              formatInTimeZone(scheduledFor, row.timeZone, 'yyyy-MM-dd'),
            steeredToward: outreach.managedPanelWave?.steeredToward ?? null,
            handoff: 'agent',
            hoursFromDraw: outreach.managedPanelWave
              ? differenceInHours(
                  scheduledFor,
                  outreach.managedPanelWave.createdAt,
                )
              : null,
          },
        ],
      ])
    }

    return this.toReportResponse(await this.loadAgentRow(outreachId))
  }

  async submitReplies(
    outreachId: number,
    input: OutreachResultsUploadRequest,
    now: Date,
  ): Promise<OutreachResultsParseReport> {
    const row = await this.model.findUnique({
      where: { outreachId },
      select: { handler: true, status: true },
    })
    if (!row || row.handler !== OutreachHandoffHandler.agent) {
      throw new NotFoundException(`No hand-off for outreach ${outreachId}`)
    }
    if (row.status !== OutreachHandoffStatus.scheduled) {
      throw new ConflictException(
        `Hand-off for outreach ${outreachId} is ${row.status}, not scheduled`,
      )
    }

    const report = await this.results.uploadByKind(
      'sms',
      String(outreachId),
      input,
    )

    if (report.committed) {
      await this.model.updateMany({
        where: { outreachId, status: OutreachHandoffStatus.scheduled },
        data: {
          status: OutreachHandoffStatus.replies_submitted,
          repliesSubmittedAt: now,
          claimedAt: null,
          claimToken: null,
        },
      })
    }
    return report
  }

  private async loadAgentRow(outreachId: number): Promise<ReportRow> {
    const row = await this.model.findUnique({
      where: { outreachId },
      include: reportInclude,
    })
    if (!row || row.handler !== OutreachHandoffHandler.agent) {
      throw new NotFoundException(`No hand-off for outreach ${outreachId}`)
    }
    return row
  }

  private staleClaim(outreachId: number): ConflictException {
    return new ConflictException(
      `The claim on hand-off ${outreachId} is no longer yours or the hand-off moved on`,
    )
  }

  // The CAS: only the live claim holder writes, and a write that finds the
  // token gone or the status wrong changes nothing.
  private async settle(
    outreachId: number,
    claimToken: string,
    data: Prisma.OutreachTextHandoffUpdateManyMutationInput,
    from?: OutreachHandoffStatus[],
  ): Promise<void> {
    const { count } = await this.model.updateMany({
      where: {
        outreachId,
        claimToken,
        ...(from ? { status: { in: from } } : {}),
      },
      data: { ...data, claimedAt: null, claimToken: null },
    })
    if (count === 0) throw this.staleClaim(outreachId)
  }

  private assertAudience(row: ReportRow, audienceCount: number): void {
    const recipients = row.outreach._count.textRecipients
    if (
      audienceCount > recipients ||
      audienceCount < recipients * (1 - AGENT_AUDIENCE_SHORTFALL_TOLERANCE)
    ) {
      throw new ConflictException(
        `Audience of ${audienceCount} does not match the ${recipients} recipients of outreach ${row.outreachId}`,
      )
    }
  }

  private isRecorded(row: ReportRow, report: AgentHandoffReport): boolean {
    if (report.status === 'needs_human') {
      return (
        row.status === OutreachHandoffStatus.needs_human &&
        row.needsHumanReason === `${report.step}: ${report.reason}`
      )
    }
    return (
      row.status === report.status &&
      row.vendorCampaignName === report.vendorCampaignName &&
      row.sendingNumber === report.sendingNumber &&
      row.audienceCount === report.audienceCount
    )
  }

  private toReportResponse(row: ReportRow): AgentHandoffReportResponse {
    const status = row.status
    if (
      status !== OutreachHandoffStatus.built &&
      status !== OutreachHandoffStatus.scheduled &&
      status !== OutreachHandoffStatus.needs_human
    ) {
      throw new ConflictException(
        `Hand-off for outreach ${row.outreachId} is ${status}`,
      )
    }
    return {
      outreachId: row.outreachId,
      status,
      repliesDueAt: row.repliesDueAt?.toISOString() ?? null,
    }
  }

  private track(
    row: ReportRow,
    events: [string, Record<string, unknown>][],
  ): void {
    if (!row.outreach.organizationSlug) return
    void trackForOffice(
      this.client,
      this.analytics,
      { organizationSlug: row.outreach.organizationSlug },
      events,
    )
  }

  // The reason is agent-written; the skill forbids phone numbers and reply
  // text in it, and Slack only gets what the report carried.
  private async alert(outreachId: number, reason: string): Promise<void> {
    try {
      await this.slack.message(
        {
          blocks: [
            {
              type: SlackMessageType.HEADER,
              text: {
                type: SlackMessageType.PLAIN_TEXT,
                text: 'Delegate needs help with a civic panel wave',
                emoji: true,
              },
            },
            {
              type: SlackMessageType.SECTION,
              text: {
                type: SlackMessageType.MRKDWN,
                text:
                  `*Outreach ID:* \`${outreachId}\`\n${reason}\n` +
                  'Schedule or finish this wave by hand, then upload the replies from the results page.',
              },
            },
          ],
        },
        SlackChannel.botTevynApi,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'Hand-off needs-human Slack failed',
      )
    }
  }
}
