import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  addDays,
  addHours,
  differenceInCalendarDays,
  differenceInDays,
  subHours,
} from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import {
  CivicPanelStatus,
  ContactStatusField,
  ManagedCivicPanelStatus,
  OutreachFunding,
  OutreachHandoffStatus,
  OutreachStatus,
  OutreachType,
  Prisma,
  type Organization,
} from '@/generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { assertManagedPanelInvite } from '@/contacts/services/managedCivicPanel.service'
import { managedPanelStatusChanged } from '@/contacts/utils/managedPanelAnalytics.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { trackForOffice } from '@/priorities/util/priorityAnalytics.util'
import {
  EVENTS,
  type SegmentTrackEventProperties,
} from 'src/vendors/segment/segment.types'
import { ManagedPanelWaveDrawService } from '@/contacts/services/managedPanelWaveDraw.service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { FeaturesService } from '@/features/services/features.service'
import { ManagedWaveFundingService } from '@/managedWaveFunding/managedWaveFunding.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import {
  nextAgentSendSlot,
  nextManagedSendDate,
  OutreachServeSmsCreateService,
  SERVE_SMS_SEND_HOUR_LOCAL,
} from '@/outreach/services/outreachServeSmsCreate.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { SERVE_CITIZEN_PANELS_FLAG } from '@/shared/util/serveCitizenPanelsFlag.util'
import { SERVE_PANEL_WAVE_AGENT_FLAG } from '@/shared/util/servePanelWaveAgentFlag.util'
import { resolveSendWindowTimeZone } from '@/shared/util/sendWindowTimeZone.util'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { EmailService } from '@/email/email.service'
import { APP_ROOT } from '@/shared/util/appEnvironment.util'
import { CIVIC_PANEL_PAGE_HREF } from '@goodparty_org/contracts'
import {
  SlackChannel,
  SlackMessageType,
} from '@/vendors/slack/slackService.types'

export const MANAGED_PANEL_WAVE_JOB = 'managedPanelWaves'
// Hourly, so a new panel's first wave and the wave after a closed one are
// drawn within the hour rather than the next morning. Not run from the
// approval itself: no request may reach claimFree
// (adr/2026-10-22-managed-panel-free-sends-and-guards).
const WAVE_CRON = '19 * * * *'

// How long after its send (11am local on the send date) a wave waits for JOIN
// replies, the same 48 hours an agent wave gets.
export const MANAGED_WAVE_REPLY_HOURS = 48

// A manual wave also waits for ops to upload its replies, so the next draw
// is sized and steered on everyone who said yes. Past its window by this
// many days it closes anyway and says so, so a missed upload cannot hold
// the panel for good.
export const MANAGED_WAVE_UPLOAD_WAIT_DAYS = 5

// Past its window by this many days with no upload, a wave posts to the
// fulfilment channel, then again at most once a day until it is uploaded.
export const MANAGED_WAVE_STALL_ALERT_DAYS = 2
const MANAGED_WAVE_STALL_REPEAT_HOURS = 24

// Free sends cost GoodParty real texts, and every PR preview would post its
// own recipient CSV to the fulfilment channel.
const WAVE_DEPLOY_ENVIRONMENTS = new Set(['dev', 'prod'])

export type WaveStep =
  | 'held'
  | 'flag_off'
  | 'waiting'
  | 'sent'
  | 'refused'
  | 'paused_at_cap'
  | 'ready'
  | 'exhausted'

const SEND_SELECT = {
  status: true,
  fundedBy: true,
  scheduledLocalDate: true,
} satisfies Prisma.OutreachSelect

type WaveSend = Prisma.OutreachGetPayload<{ select: typeof SEND_SELECT }>

type Enrollment = {
  id: string
  organizationSlug: string
  inviteMessage: string
  goalMembers: number
  approvedByUserId: number | null
}

// How an agent-handled wave goes out: the next 11am local slot, weekends
// allowed. Resolved once per send step from the approving official's flag.
type AgentPlan = {
  mode: 'shadow' | 'auto'
  timeZone: string
  sendAt: Date
  scheduledLocalDate: string
}

const isAwaitingAgent = (
  outreach: {
    status: OutreachStatus | null
    textHandoff: { status: OutreachHandoffStatus } | null
  } | null,
): boolean => {
  if (outreach === null) return false
  // An agent wave has no reply window: its replies arriving is the close.
  if (outreach.textHandoff !== null) {
    return (
      outreach.textHandoff.status !== OutreachHandoffStatus.replies_submitted
    )
  }
  return (
    outreach.status === OutreachStatus.pending ||
    outreach.status === OutreachStatus.in_progress
  )
}

// Advances every building managed civic panel by one step an hour: closes a
// wave whose reply window has passed (and, sent by hand, whose replies are in), then draws, creates, claims free and
// queues the next, or marks the panel ready or exhausted. Every step is
// re-derived from the rows, so a pass that dies partway is finished by the
// next. See the contacts AGENTS.md, "Managed civic panel".
@Injectable()
export class ManagedPanelWaveJobService extends createPrismaBase(
  MODELS.ManagedCivicPanel,
) {
  constructor(
    private readonly cronLock: CronLockService,
    private readonly features: FeaturesService,
    private readonly draws: ManagedPanelWaveDrawService,
    private readonly funding: ManagedWaveFundingService,
    private readonly serveSms: OutreachServeSmsCreateService,
    private readonly organizations: OrganizationsService,
    private readonly contactStatus: ContactStatusService,
    private readonly slack: SlackService,
    private readonly email: EmailService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  private track(
    organizationSlug: string,
    events: [string, SegmentTrackEventProperties][],
  ): void {
    void trackForOffice(
      this.client,
      this.analytics,
      { organizationSlug },
      events,
    )
  }

  @Cron(WAVE_CRON, { name: MANAGED_PANEL_WAVE_JOB, timeZone: EASTERN_TIMEZONE })
  async runDaily(): Promise<void> {
    if (
      !WAVE_DEPLOY_ENVIRONMENTS.has(process.env.OTEL_SERVICE_ENVIRONMENT ?? '')
    ) {
      return
    }
    const now = new Date()
    if (!(await this.cronLock.tryClaimHourlyRun(MANAGED_PANEL_WAVE_JOB, now))) {
      return
    }
    try {
      await this.runWaves(now)
    } finally {
      await this.cronLock.markHourlyCompleted(MANAGED_PANEL_WAVE_JOB, now)
    }
  }

  async runWaves(now: Date = new Date()): Promise<void> {
    const building = await this.model.findMany({
      where: { status: ManagedCivicPanelStatus.building },
      select: { id: true },
    })
    for (const { id } of building) {
      try {
        const step = await this.advance(id, now)
        this.logger.info({ enrollmentId: id, step }, 'Managed panel advanced')
      } catch (err) {
        this.logger.error(
          { err, enrollmentId: id },
          'Managed panel wave step failed; retried on the next run',
        )
      }
    }
    await this.sendReadyEmails()
  }

  async advance(enrollmentId: string, now: Date): Promise<WaveStep> {
    const enrollment = await this.model.findUnique({
      where: { id: enrollmentId },
      select: {
        id: true,
        status: true,
        organizationSlug: true,
        inviteMessage: true,
        goalMembers: true,
        approvedByUserId: true,
      },
    })
    if (enrollment?.status !== ManagedCivicPanelStatus.building) return 'held'
    // claimFree checks the flag again; this stops an unflagged office from
    // having waves drawn that could never go out.
    if (
      enrollment.approvedByUserId === null ||
      !(await this.features.isFeatureEnabled({
        user: enrollment.approvedByUserId,
        feature: SERVE_CITIZEN_PANELS_FLAG,
      }))
    ) {
      return 'flag_off'
    }

    const open = await this.client.managedPanelWave.findFirst({
      where: { enrollmentId, closedAt: null },
      orderBy: { wave: Prisma.SortOrder.asc },
      select: {
        id: true,
        wave: true,
        sentAt: true,
        replyWindowEndsAt: true,
        repliesUploadedAt: true,
        voterFileFilterId: true,
        outreach: {
          select: { status: true, textHandoff: { select: { status: true } } },
        },
      },
    })
    if (open && open.sentAt === null) return this.send(enrollment, open.id, now)
    if (open) {
      if (open.replyWindowEndsAt !== null && open.replyWindowEndsAt > now) {
        return 'waiting'
      }
      // An agent wave has no window until the agent reports its real send. A
      // manual wave always gets one when it is marked sent, so a null window
      // is the agent's: its hand-off row exists, or delivery has not made it
      // yet.
      if (open.replyWindowEndsAt === null && isAwaitingAgent(open.outreach)) {
        return 'waiting'
      }
      const awaitingUpload =
        open.replyWindowEndsAt !== null &&
        open.outreach?.textHandoff === null &&
        open.repliesUploadedAt === null
      if (
        awaitingUpload &&
        open.replyWindowEndsAt !== null &&
        addDays(open.replyWindowEndsAt, MANAGED_WAVE_UPLOAD_WAIT_DAYS) > now
      ) {
        if (
          addDays(open.replyWindowEndsAt, MANAGED_WAVE_STALL_ALERT_DAYS) <= now
        ) {
          await this.alertStalled(
            enrollment.organizationSlug,
            { ...open, replyWindowEndsAt: open.replyWindowEndsAt },
            now,
          )
        }
        return 'waiting'
      }
      const closed = await this.close(enrollment.organizationSlug, open, now)
      if (closed && awaitingUpload) {
        await this.postFulfilment(
          'Civic panel wave closed without its replies',
          `*Organization*: ${enrollment.organizationSlug}\n` +
            `*Wave*: ${open.wave}\n` +
            `No results were uploaded within ${MANAGED_WAVE_UPLOAD_WAIT_DAYS} ` +
            'days of its replies closing, so it closed without them and ' +
            'the next wave is drawn from the members on file.',
        )
      }
    }

    const members = await this.memberIds(enrollment.organizationSlug)
    if (members.length >= enrollment.goalMembers) {
      return this.finish(enrollment.id, ManagedCivicPanelStatus.ready, now)
    }
    const draw = await this.draws.drawNextWave(enrollmentId)
    switch (draw.outcome) {
      case 'drawn':
      case 'pending':
        return this.send(enrollment, draw.wave.id, now)
      case 'goal_reached':
        return this.finish(enrollment.id, ManagedCivicPanelStatus.ready, now)
      case 'exhausted':
        return this.finish(
          enrollment.id,
          ManagedCivicPanelStatus.exhausted,
          now,
        )
      case 'out_of_free_texts':
        return this.pauseOutOfTexts(enrollment, now)
      case 'not_building':
        return 'held'
    }
  }

  // Makes the wave's send if it has none, claims it free, and marks the wave
  // sent. Safe to repeat at any point: the send is unique per wave, a claim
  // left `pending` is resumed by claimFree, and one already handed off is
  // only marked.
  private async send(
    enrollment: Enrollment,
    waveId: string,
    now: Date,
  ): Promise<WaveStep> {
    const agent = await this.agentPlan(enrollment, now)
    const existing = await this.client.outreach.findUnique({
      where: { managedPanelWaveId: waveId },
      select: SEND_SELECT,
    })
    const outreach =
      existing ?? (await this.createSend(enrollment, waveId, now, agent))
    if (!outreach) {
      return this.finish(enrollment.id, ManagedCivicPanelStatus.exhausted, now)
    }
    const handedOff =
      outreach.fundedBy === OutreachFunding.goodparty_pilot &&
      outreach.status !== OutreachStatus.pending_payment &&
      outreach.status !== OutreachStatus.pending
    // Frozen per wave: a hand-off row already made for this send wins over
    // the flag now, and every enqueue of the send repeats it, so the Slack
    // post never loses its "agent is handling this" note while the row exists.
    const row = await this.client.outreachTextHandoff.findFirst({
      where: { outreach: { managedPanelWaveId: waveId } },
      select: { mode: true, sendAt: true, timeZone: true },
    })
    const agentHandled = row !== null || (!handedOff && agent !== null)
    if (!handedOff) {
      if (outreach.status === OutreachStatus.pending_payment) {
        await this.refreshDraft(enrollment, waveId, now, agent)
      }
      const claim = await this.funding.claimFree(
        waveId,
        row
          ? {
              mode: row.mode === 'auto' ? 'auto' : 'shadow',
              sendAt: row.sendAt,
              timeZone: row.timeZone,
            }
          : agent
            ? {
                mode: agent.mode,
                sendAt: agent.sendAt,
                timeZone: agent.timeZone,
              }
            : undefined,
      )
      if (!claim.claimed) {
        return claim.reason === 'over_cap' ? 'paused_at_cap' : 'refused'
      }
    }
    const sent = await this.client.outreach.findUniqueOrThrow({
      where: { managedPanelWaveId: waveId },
      select: { scheduledLocalDate: true },
    })
    const sendDate =
      sent.scheduledLocalDate ??
      agent?.scheduledLocalDate ??
      nextManagedSendDate(now)
    const { count } = await this.client.managedPanelWave.updateMany({
      where: { id: waveId, sentAt: null },
      data: {
        sentAt: now,
        ...(agentHandled
          ? {}
          : {
              replyWindowEndsAt: addHours(
                fromZonedTime(
                  `${sendDate}T${SERVE_SMS_SEND_HOUR_LOCAL}:00:00`,
                  await this.sendTimeZone(enrollment.organizationSlug),
                ),
                MANAGED_WAVE_REPLY_HOURS,
              ),
            }),
      },
    })
    // An agent wave's Sent fires from its report, once the real send is known.
    if (count > 0 && !agentHandled) {
      const wave = await this.client.managedPanelWave.findUniqueOrThrow({
        where: { id: waveId },
        select: {
          wave: true,
          steeredToward: true,
          outreach: { select: { textCount: true } },
        },
      })
      this.track(enrollment.organizationSlug, [
        [
          EVENTS.Contacts.CivicPanelWaveSent,
          {
            wave: wave.wave,
            texts: wave.outreach?.textCount ?? 0,
            sendDate,
            steeredToward: wave.steeredToward,
            handoff: 'manual',
          },
        ],
      ])
    }
    return 'sent'
  }

  // Null unless the approving official's `serve-panel-wave-agent` flag
  // assigns shadow or auto; any other variant, or none, is off.
  private async agentPlan(
    enrollment: Enrollment,
    now: Date,
  ): Promise<AgentPlan | null> {
    if (enrollment.approvedByUserId === null) return null
    const variant = await this.features.getFeatureVariant({
      user: enrollment.approvedByUserId,
      feature: SERVE_PANEL_WAVE_AGENT_FLAG,
    })
    if (variant !== 'shadow' && variant !== 'auto') return null
    const timeZone = await this.sendTimeZone(enrollment.organizationSlug)
    return { mode: variant, timeZone, ...nextAgentSendSlot(now, timeZone) }
  }

  private async sendTimeZone(organizationSlug: string): Promise<string> {
    const district =
      await this.organizations.getDistrictForOrgSlug(organizationSlug)
    return resolveSendWindowTimeZone(district?.state)
  }

  // The wave's send as an unpaid Serve text draft of the approved invite,
  // counted the way a draft is. Null when the list reaches nobody, whose
  // wave is dropped so its people stay drawable.
  private async createSend(
    enrollment: Enrollment,
    waveId: string,
    now: Date,
    agent: AgentPlan | null,
  ): Promise<WaveSend | null> {
    assertManagedPanelInvite(enrollment.inviteMessage)
    const scheduledLocalDate =
      agent?.scheduledLocalDate ?? nextManagedSendDate(now)
    const wave = await this.client.managedPanelWave.findUniqueOrThrow({
      where: { id: waveId },
      select: {
        voterFileFilter: true,
        enrollment: { select: { organization: true } },
      },
    })
    const list = wave.voterFileFilter
    if (!list || list.organizationSlug !== enrollment.organizationSlug) {
      throw new Error('Managed panel wave has no list of its own office')
    }
    const organization: Organization = wave.enrollment.organization
    const { recipientCount } = await this.serveSms.resolveListAudienceCount(
      organization,
      { ...list },
      organization.slug,
    )
    if (recipientCount < 1) {
      await this.client.$transaction([
        this.client.managedPanelWave.delete({ where: { id: waveId } }),
        this.client.voterFileFilter.delete({ where: { id: list.id } }),
      ])
      return null
    }
    try {
      return await this.client.outreach.create({
        data: {
          campaignId: null,
          organizationSlug: organization.slug,
          outreachType: OutreachType.text,
          status: OutreachStatus.pending_payment,
          name: list.name ?? 'Civic panel invite',
          message: enrollment.inviteMessage,
          asksToJoinCivicPanel: true,
          offersCivicPanelLeave: false,
          scheduledLocalDate,
          voterFileFilterId: list.id,
          textCount: recipientCount,
          managedPanelWaveId: waveId,
        },
        select: SEND_SELECT,
      })
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err
      return this.client.outreach.findUniqueOrThrow({
        where: { managedPanelWaveId: waveId },
        select: SEND_SELECT,
      })
    }
  }

  // A draft left unclaimed by an earlier run (the flag was off, or the
  // official approved new words after a stop) goes out with today's lead
  // and the invite as approved now. Only an unfunded draft is touched.
  private async refreshDraft(
    enrollment: Enrollment,
    waveId: string,
    now: Date,
    agent: AgentPlan | null,
  ): Promise<void> {
    assertManagedPanelInvite(enrollment.inviteMessage)
    const scheduledLocalDate =
      agent?.scheduledLocalDate ?? nextManagedSendDate(now)
    await this.client.outreach.updateMany({
      where: {
        managedPanelWaveId: waveId,
        status: OutreachStatus.pending_payment,
        fundedBy: null,
        OR: [
          {
            scheduledLocalDate: agent
              ? { not: scheduledLocalDate }
              : { lt: scheduledLocalDate },
          },
          { scheduledLocalDate: null },
          { message: { not: enrollment.inviteMessage } },
        ],
      },
      data: { scheduledLocalDate, message: enrollment.inviteMessage },
    })
  }

  // JOIN replies make members through the reply ingest; closing records how
  // many of the people this wave drew are members now.
  private async close(
    organizationSlug: string,
    wave: { id: string; voterFileFilterId: number | null },
    now: Date,
  ): Promise<boolean> {
    const members = new Set(await this.memberIds(organizationSlug))
    const drawn =
      wave.voterFileFilterId === null
        ? []
        : await this.client.voterFileFilterSampleMember.findMany({
            where: { voterFileFilterId: wave.voterFileFilterId },
            select: { personId: true },
          })
    const joinedMembers = drawn.filter((row) =>
      members.has(row.personId),
    ).length
    const { count } = await this.client.managedPanelWave.updateMany({
      where: { id: wave.id, closedAt: null },
      data: { closedAt: now, joinedMembers },
    })
    if (count > 0) {
      const closed = await this.client.managedPanelWave.findUniqueOrThrow({
        where: { id: wave.id },
        select: { wave: true },
      })
      this.track(organizationSlug, [
        [
          EVENTS.Contacts.CivicPanelWaveClosed,
          {
            wave: closed.wave,
            invited: drawn.length,
            joinedMembers,
            membersAfter: members.size,
          },
        ],
      ])
    }
    return count > 0
  }

  // Claimed before it posts, so hourly runs post at most once a day.
  private async alertStalled(
    organizationSlug: string,
    wave: { id: string; wave: number; replyWindowEndsAt: Date },
    now: Date,
  ): Promise<void> {
    const { count } = await this.client.managedPanelWave.updateMany({
      where: {
        id: wave.id,
        repliesUploadedAt: null,
        OR: [
          { stallAlertedAt: null },
          {
            stallAlertedAt: {
              lte: subHours(now, MANAGED_WAVE_STALL_REPEAT_HOURS),
            },
          },
        ],
      },
      data: { stallAlertedAt: now },
    })
    if (count === 0) return
    const waited = differenceInDays(now, wave.replyWindowEndsAt)
    const left = MANAGED_WAVE_UPLOAD_WAIT_DAYS - waited
    await this.postFulfilment(
      'Civic panel wave waiting on its replies',
      `*Organization*: ${organizationSlug}\n` +
        `*Wave*: ${wave.wave}\n` +
        `Its replies closed ${waited} days ago and no results have been ` +
        'uploaded. Upload them, or the file with no replies, so the next ' +
        `wave can go out. It closes without them in ${left} days.`,
    )
  }

  private async postFulfilment(header: string, text: string): Promise<void> {
    try {
      await this.slack.message(
        {
          blocks: [
            {
              type: SlackMessageType.HEADER,
              text: {
                type: SlackMessageType.PLAIN_TEXT,
                text: header,
                emoji: true,
              },
            },
            {
              type: SlackMessageType.SECTION,
              text: { type: SlackMessageType.MRKDWN, text },
            },
          ],
        },
        SlackChannel.botTevynApi,
      )
    } catch (err) {
      this.logger.error(
        { err, header },
        'Managed panel fulfilment notice failed',
      )
    }
  }

  private memberIds(organizationSlug: string): Promise<string[]> {
    return this.contactStatus.personIdsByFieldValue(
      organizationSlug,
      ContactStatusField.civic_panel,
      [CivicPanelStatus.member],
    )
  }

  private async finish(
    enrollmentId: string,
    status: 'ready' | 'exhausted',
    now: Date,
  ): Promise<WaveStep> {
    const { count } = await this.model.updateMany({
      where: { id: enrollmentId, status: ManagedCivicPanelStatus.building },
      data:
        status === ManagedCivicPanelStatus.ready
          ? { status, readyAt: now }
          : { status },
    })
    if (count > 0) await this.trackFinished(enrollmentId, status, now)
    return status
  }

  private async trackFinished(
    enrollmentId: string,
    status: 'ready' | 'exhausted',
    now: Date,
  ): Promise<void> {
    const enrollment = await this.model.findUniqueOrThrow({
      where: { id: enrollmentId },
      select: {
        organizationSlug: true,
        goalMembers: true,
        approvedAt: true,
        _count: { select: { waves: { where: { sentAt: { not: null } } } } },
      },
    })
    const members = (await this.memberIds(enrollment.organizationSlug)).length
    this.track(enrollment.organizationSlug, [
      managedPanelStatusChanged({
        from: ManagedCivicPanelStatus.building,
        to: status,
        members,
        changedBy: 'system',
      }),
      ...(status === ManagedCivicPanelStatus.ready
        ? [
            [
              EVENTS.Contacts.CivicPanelReady,
              {
                members,
                goalMembers: enrollment.goalMembers,
                wavesSent: enrollment._count.waves,
                daysToReady: differenceInCalendarDays(
                  now,
                  enrollment.approvedAt,
                ),
              },
            ] satisfies [string, SegmentTrackEventProperties],
          ]
        : []),
    ])
  }

  // One email to the official for each time their panel reaches its goal.
  // Read off the rows rather than sent from the step that marked it ready,
  // so a send that failed is tried again on the next run.
  async sendReadyEmails(): Promise<void> {
    const ready = await this.model.findMany({
      where: {
        status: ManagedCivicPanelStatus.ready,
        readyEmailSentAt: null,
        approvedByUserId: { not: null },
      },
      select: { id: true, organizationSlug: true, approvedByUserId: true },
    })
    for (const enrollment of ready) {
      try {
        await this.sendReadyEmail(enrollment)
      } catch (err) {
        this.logger.error(
          { err, enrollmentId: enrollment.id },
          'Managed panel ready email failed; retried on the next run',
        )
      }
    }
  }

  // Claimed before it is sent, so two runs never both send it, and handed
  // back if the send fails.
  private async sendReadyEmail(enrollment: {
    id: string
    organizationSlug: string
    approvedByUserId: number | null
  }): Promise<void> {
    const userId = enrollment.approvedByUserId
    if (
      userId === null ||
      !(await this.features.isFeatureEnabled({
        user: userId,
        feature: SERVE_CITIZEN_PANELS_FLAG,
      }))
    ) {
      return
    }
    const { count } = await this.model.updateMany({
      where: {
        id: enrollment.id,
        status: ManagedCivicPanelStatus.ready,
        readyEmailSentAt: null,
      },
      data: { readyEmailSentAt: new Date() },
    })
    if (count === 0) return
    const [user, members] = await Promise.all([
      this.client.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, firstName: true },
      }),
      this.memberIds(enrollment.organizationSlug),
    ])
    const message = managedPanelReadyEmail(user.firstName, members.length)
    try {
      await this.email.sendEmail({
        to: user.email,
        subject: 'Your civic panel is ready',
        message,
        html: message.replace(/\n/g, '<br />'),
      })
    } catch (err) {
      await this.model.updateMany({
        where: { id: enrollment.id },
        data: { readyEmailSentAt: null },
      })
      throw err
    }
    this.logger.info(
      { enrollmentId: enrollment.id },
      'Managed panel ready email sent',
    )
  }

  // Every free text is spent and the goal is not met: pause, as claimFree
  // does for a wave over the cap, so staff decide whether to raise it.
  private async pauseOutOfTexts(
    enrollment: Enrollment,
    now: Date,
  ): Promise<WaveStep> {
    const { count } = await this.model.updateMany({
      where: { id: enrollment.id, status: ManagedCivicPanelStatus.building },
      data: { status: ManagedCivicPanelStatus.paused, pausedAt: now },
    })
    if (count === 0) return 'held'
    this.track(enrollment.organizationSlug, [
      managedPanelStatusChanged({
        from: ManagedCivicPanelStatus.building,
        to: ManagedCivicPanelStatus.paused,
        members: (await this.memberIds(enrollment.organizationSlug)).length,
        changedBy: 'system',
      }),
    ])
    this.logger.warn(
      { enrollmentId: enrollment.id },
      'Managed civic panel paused with its free texts spent',
    )
    try {
      await this.slack.message(
        {
          blocks: [
            {
              type: SlackMessageType.HEADER,
              text: {
                type: SlackMessageType.PLAIN_TEXT,
                text: 'Managed civic panel paused at its free text cap',
                emoji: true,
              },
            },
            {
              type: SlackMessageType.SECTION,
              text: {
                type: SlackMessageType.MRKDWN,
                text:
                  `*Organization*: ${enrollment.organizationSlug}\n` +
                  'Every free text is spent and the panel is short of its ' +
                  'goal. Raise the cap and resume it to keep building.',
              },
            },
          ],
        },
        SlackChannel.botTevynApi,
      )
    } catch (err) {
      this.logger.error({ err }, 'Managed panel cap notice failed')
    }
    return 'paused_at_cap'
  }
}

// The ready email's words. Serve copy: residents, never voters.
export const managedPanelReadyEmail = (
  firstName: string | null,
  members: number,
): string =>
  [
    firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi,',
    '',
    `Your civic panel is ready. ${members} residents from across your district said yes to hearing from you.`,
    '',
    'Ask them what they think whenever you want to hear from your whole ' +
      'district.',
    '',
    `See your civic panel: ${APP_ROOT}${CIVIC_PANEL_PAGE_HREF}`,
    '',
    'GoodParty.org',
  ].join('\n')
