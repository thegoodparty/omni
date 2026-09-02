import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  checkSmsStandards,
  type ApproveSmsOutreachRequest,
  type DenySmsOutreachRequest,
  type SmsAdminDetailResponse,
  type SmsAdminJobStats,
  type SmsApprovalQueueItem,
  type SmsApprovalStatus,
} from '@goodparty_org/contracts'
import { OutreachStatus, OutreachType, Prisma } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { PeerlyP2pJobService } from 'src/vendors/peerly/services/peerlyP2pJob.service'
import { PeerlyJob } from 'src/vendors/peerly/peerly.types'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { EmailService } from 'src/email/email.service'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import { SlackChannel } from 'src/vendors/slack/slackService.types'

const queueInclude = {
  campaign: { include: { user: true } },
} satisfies Prisma.OutreachInclude

type QueueRow = Prisma.OutreachGetPayload<{ include: typeof queueInclude }>

// The CAS approval back office (gp-admin). Scope is deliberately the cancel
// window: a p2p row at spine `pending` with a vendor job — the state where
// the job exists at Peerly but nothing sends until canvassers are requested.
@Injectable()
export class OutreachSmsAdminService extends createPrismaBase(MODELS.Outreach) {
  constructor(
    private readonly peerlyP2pJobService: PeerlyP2pJobService,
    private readonly analytics: AnalyticsService,
    private readonly email: EmailService,
    private readonly slack: SlackService,
  ) {
    super()
  }

  private queueWhere(): Prisma.OutreachWhereInput {
    return {
      outreachType: OutreachType.p2p,
      status: OutreachStatus.pending,
      projectId: { not: null },
    }
  }

  async listQueue(): Promise<SmsApprovalQueueItem[]> {
    const rows = await this.model.findMany({
      where: this.queueWhere(),
      include: queueInclude,
      orderBy: [{ date: Prisma.SortOrder.asc }],
    })

    const committeeNames = await this.committeeNamesByCampaign(rows)
    const jobsByProjectId = await this.liveJobsFor(rows)
    return rows.map((row) =>
      this.toQueueItem(
        row,
        committeeNames.get(row.campaignId ?? -1) ?? [],
        row.projectId ? (jobsByProjectId.get(row.projectId) ?? null) : null,
      ),
    )
  }

  async getDetail(outreachId: number): Promise<SmsAdminDetailResponse> {
    const row = await this.model.findFirst({
      where: { id: outreachId, ...this.queueWhere() },
      include: queueInclude,
    })
    if (!row || !row.projectId) {
      throw new NotFoundException('Scheduled SMS campaign not found')
    }

    const committeeNames = await this.committeeNamesByCampaign([row])

    // Live reads are additive detail — either failing must not 404 the row.
    let job: PeerlyJob | null = null
    try {
      job = await this.peerlyP2pJobService.getJob(row.projectId)
    } catch (err) {
      this.logger.warn(
        { err, outreachId },
        'Admin detail: live job read failed; rendering without it',
      )
    }
    let stats: SmsAdminJobStats | null = null
    try {
      stats = await this.peerlyP2pJobService.getJobDetailedStats(row.projectId)
    } catch (err) {
      this.logger.warn(
        { err, outreachId },
        'Admin detail: job stats read failed; rendering without them',
      )
    }

    return {
      item: this.toQueueItem(
        row,
        committeeNames.get(row.campaignId ?? -1) ?? [],
        job,
      ),
      stats,
    }
  }

  /**
   * The one human gate: claim the row (CAS-style, so two admins can't both
   * book the send), request Peerly's canvassers, then stamp the request. A
   * vendor failure reverts the claim so the queue row stays actionable.
   */
  async approve(
    outreachId: number,
    input: ApproveSmsOutreachRequest,
  ): Promise<SmsApprovalQueueItem> {
    const row = await this.model.findFirst({
      where: { id: outreachId },
      include: queueInclude,
    })
    if (!row) {
      throw new NotFoundException('Outreach not found')
    }
    if (row.approvedAt) {
      throw new ConflictException('This campaign is already approved')
    }
    if (row.deniedAt) {
      throw new ConflictException(
        'This campaign was denied — it re-queues when the candidate edits',
      )
    }
    if (
      row.status !== OutreachStatus.pending ||
      row.outreachType !== OutreachType.p2p ||
      !row.projectId
    ) {
      throw new BadRequestException(
        'Only scheduled SMS campaigns can be approved',
      )
    }

    const claimed = await this.model.updateMany({
      where: {
        id: outreachId,
        status: OutreachStatus.pending,
        approvedAt: null,
        deniedAt: null,
      },
      data: { approvedAt: new Date(), approvedBy: input.approvedBy },
    })
    if (claimed.count === 0) {
      throw new ConflictException('This campaign was just decided elsewhere')
    }

    try {
      await this.peerlyP2pJobService.requestCanvassers(row.projectId, {
        initials: input.initials,
        date: row.scheduledLocalDate ?? undefined,
      })
    } catch (error) {
      await this.model.update({
        where: { id: outreachId },
        data: { approvedAt: null, approvedBy: null },
      })
      throw error
    }

    const updated = await this.model.update({
      where: { id: outreachId },
      data: { canvassRequestedAt: new Date() },
      include: queueInclude,
    })

    const committeeNames = await this.committeeNamesByCampaign([updated])
    await this.tryNotifyDecision(updated, 'approved', input.approvedBy)
    if (updated.campaign?.user) {
      await this.tryTrack(
        updated.campaign.user.id,
        'Voter Outreach - Campaign Approved',
        { channel: 'sms' },
      )
    }
    return this.toQueueItem(
      updated,
      committeeNames.get(updated.campaignId ?? -1) ?? [],
      null,
    )
  }

  async deny(
    outreachId: number,
    input: DenySmsOutreachRequest,
  ): Promise<SmsApprovalQueueItem> {
    const denied = await this.model.updateMany({
      where: {
        id: outreachId,
        status: OutreachStatus.pending,
        outreachType: OutreachType.p2p,
        approvedAt: null,
        deniedAt: null,
      },
      data: {
        deniedAt: new Date(),
        deniedBy: input.deniedBy,
        deniedReason: input.reason,
      },
    })
    if (denied.count === 0) {
      const current = await this.findFirst({ where: { id: outreachId } })
      if (!current) {
        throw new NotFoundException('Outreach not found')
      }
      throw new ConflictException(
        'This campaign is not awaiting review any more',
      )
    }

    const updated = await this.model.findFirstOrThrow({
      where: { id: outreachId },
      include: queueInclude,
    })
    const committeeNames = await this.committeeNamesByCampaign([updated])
    await this.tryNotifyDecision(updated, 'denied', input.deniedBy)
    await this.tryEmailDenial(updated, input.reason)
    return this.toQueueItem(
      updated,
      committeeNames.get(updated.campaignId ?? -1) ?? [],
      null,
    )
  }

  private async committeeNamesByCampaign(
    rows: QueueRow[],
  ): Promise<Map<number, string[]>> {
    const campaignIds = [
      ...new Set(
        rows
          .map((row) => row.campaignId)
          .filter((id): id is number => id !== null),
      ),
    ]
    if (campaignIds.length === 0) return new Map()
    const records = await this.client.tcrCompliance.findMany({
      where: { campaignId: { in: campaignIds } },
      select: { campaignId: true, committeeName: true, candidateName: true },
    })
    return new Map(
      records.map((r) => [
        r.campaignId,
        [r.committeeName, r.candidateName].filter(
          (name): name is string => !!name,
        ),
      ]),
    )
  }

  // One vendor list-read per identity, never per row; a failed identity
  // renders its rows with job: null rather than failing the queue.
  private async liveJobsFor(rows: QueueRow[]): Promise<Map<string, PeerlyJob>> {
    const identityIds = [
      ...new Set(
        rows
          .map((row) => row.identityId)
          .filter((id): id is string => id !== null),
      ),
    ]
    const byProjectId = new Map<string, PeerlyJob>()
    for (const identityId of identityIds) {
      try {
        const jobs =
          await this.peerlyP2pJobService.getJobsByIdentityId(identityId)
        for (const job of jobs) {
          byProjectId.set(job.id, job)
        }
      } catch (err) {
        this.logger.warn(
          { err, identityId },
          'Admin queue: live job read failed for identity; rendering rows without it',
        )
      }
    }
    return byProjectId
  }

  private toQueueItem(
    row: QueueRow,
    registrationNames: string[],
    job: PeerlyJob | null,
  ): SmsApprovalQueueItem {
    const user = row.campaign?.user ?? null
    const candidateName = user
      ? `${(user.firstName ?? '').trim()} ${(user.lastName ?? '').trim()}`.trim() ||
        null
      : null
    const identityNames = [candidateName, ...registrationNames].filter(
      (name): name is string => !!name,
    )
    return {
      id: row.id,
      campaignId: row.campaignId ?? -1,
      campaignSlug: row.campaign?.slug ?? '',
      candidateName,
      name: row.name,
      createdAt: row.createdAt,
      sendAt: row.date,
      scheduledLocalDate: row.scheduledLocalDate,
      script: row.script,
      imageUrl: row.imageUrl,
      textCount: row.textCount,
      billableTextCount: row.billableTextCount,
      paid: row.stripeCheckoutSessionId !== null,
      approvalStatus: this.deriveStatus(row, job),
      approvedAt: row.approvedAt,
      approvedBy: row.approvedBy,
      deniedAt: row.deniedAt,
      deniedBy: row.deniedBy,
      deniedReason: row.deniedReason,
      canvassRequestedAt: row.canvassRequestedAt,
      standards: row.script
        ? checkSmsStandards(row.script, { identityNames })
        : null,
      job: job
        ? {
            status: job.status,
            deliverabilityCheckError: job.deliverability_check_error ?? null,
            hasCanvassersScheduled: job.has_canvassers_scheduled,
            peerlyApproved: job.canvassers_schedule?.approved ?? null,
            leadsRemaining: job.leads_remaining ?? null,
          }
        : null,
    }
  }

  private deriveStatus(
    row: QueueRow,
    job: PeerlyJob | null,
  ): SmsApprovalStatus {
    if (row.deniedAt) return 'denied'
    if (job?.canvassers_schedule?.approved) return 'peerly_approved'
    if (row.canvassRequestedAt) return 'canvass_requested'
    return 'awaiting_review'
  }

  private async tryNotifyDecision(
    row: QueueRow,
    decision: 'approved' | 'denied',
    actor: string,
  ) {
    try {
      await this.slack.message(
        {
          text:
            `SMS campaign ${decision}: "${row.name ?? row.id}" ` +
            `(${row.campaign?.slug ?? 'unknown campaign'}, ` +
            `${row.billableTextCount ?? row.textCount ?? '?'} texts, ` +
            `send ${row.scheduledLocalDate ?? 'unscheduled'}) by ${actor}`,
        },
        SlackChannel.casClickupTasks,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId: row.id },
        'CAS decision Slack notification failed',
      )
    }
  }

  private async tryEmailDenial(row: QueueRow, reason: string) {
    const user = row.campaign?.user
    if (!user?.email) return
    try {
      await this.email.sendEmail({
        to: user.email,
        subject: 'Your text campaign needs changes before it can send',
        message:
          `Our team reviewed your scheduled text campaign` +
          `${row.name ? ` "${row.name}"` : ''} and it needs a change ` +
          `before it can go out:\n\n${reason}\n\n` +
          `You can edit the campaign from your Voter Outreach page — ` +
          `once you save changes it comes back to us for a quick ` +
          `re-review, and your send date stays yours.`,
      })
    } catch (err) {
      this.logger.error({ err, outreachId: row.id }, 'CAS denial email failed')
    }
  }

  private async tryTrack(
    userId: number,
    event: string,
    properties: Record<string, string>,
  ) {
    try {
      await this.analytics.track(userId, event, properties)
    } catch (err) {
      this.logger.error({ err, event }, 'CAS console analytics track failed')
    }
  }
}
