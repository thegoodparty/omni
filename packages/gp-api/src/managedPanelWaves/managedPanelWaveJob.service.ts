import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addDays, parseISO } from 'date-fns'
import {
  CivicPanelStatus,
  ContactStatusField,
  ManagedCivicPanelStatus,
  OutreachFunding,
  OutreachStatus,
  OutreachType,
  Prisma,
  type Organization,
} from '@/generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { assertManagedPanelInvite } from '@/contacts/services/managedCivicPanel.service'
import { ManagedPanelWaveDrawService } from '@/contacts/services/managedPanelWaveDraw.service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { FeaturesService } from '@/features/services/features.service'
import { ManagedWaveFundingService } from '@/managedWaveFunding/managedWaveFunding.service'
import {
  assertServeSmsSendDateAllowed,
  nextManagedSendDate,
  OutreachServeSmsCreateService,
} from '@/outreach/services/outreachServeSmsCreate.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { SERVE_CITIZEN_PANELS_FLAG } from '@/shared/util/serveCitizenPanelsFlag.util'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { EmailService } from '@/email/email.service'
import { APP_ROOT } from '@/shared/util/appEnvironment.util'
import { CIVIC_PANEL_PAGE_HREF } from '@goodparty_org/contracts'
import {
  SlackChannel,
  SlackMessageType,
} from '@/vendors/slack/slackService.types'

export const MANAGED_PANEL_WAVE_JOB = 'managedPanelWaves'
const WAVE_CRON = '19 8 * * *'

// How long after its send date a wave waits for JOIN replies before the
// next one is drawn.
export const MANAGED_WAVE_REPLY_DAYS = 5

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
}

// Advances every building managed civic panel by one step a day: closes a
// wave whose reply window has passed, then draws, creates, claims free and
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
    private readonly contactStatus: ContactStatusService,
    private readonly slack: SlackService,
    private readonly email: EmailService,
  ) {
    super()
  }

  @Cron(WAVE_CRON, { name: MANAGED_PANEL_WAVE_JOB, timeZone: EASTERN_TIMEZONE })
  async runDaily(): Promise<void> {
    if (
      !WAVE_DEPLOY_ENVIRONMENTS.has(process.env.OTEL_SERVICE_ENVIRONMENT ?? '')
    ) {
      return
    }
    const now = new Date()
    if (!(await this.cronLock.tryClaimDailyRun(MANAGED_PANEL_WAVE_JOB, now))) {
      return
    }
    try {
      await this.runWaves(now)
    } finally {
      await this.cronLock.markCompleted(MANAGED_PANEL_WAVE_JOB, now)
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
        sentAt: true,
        replyWindowEndsAt: true,
        voterFileFilterId: true,
      },
    })
    if (open && open.sentAt === null) return this.send(enrollment, open.id, now)
    if (open) {
      if (open.replyWindowEndsAt !== null && open.replyWindowEndsAt > now) {
        return 'waiting'
      }
      await this.close(enrollment.organizationSlug, open, now)
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
    const existing = await this.client.outreach.findUnique({
      where: { managedPanelWaveId: waveId },
      select: SEND_SELECT,
    })
    const outreach =
      existing ?? (await this.createSend(enrollment, waveId, now))
    if (!outreach) {
      return this.finish(enrollment.id, ManagedCivicPanelStatus.exhausted, now)
    }
    const handedOff =
      outreach.fundedBy === OutreachFunding.goodparty_pilot &&
      outreach.status !== OutreachStatus.pending_payment &&
      outreach.status !== OutreachStatus.pending
    if (!handedOff) {
      if (outreach.status === OutreachStatus.pending_payment) {
        await this.refreshDraft(enrollment, waveId, now)
      }
      const claim = await this.funding.claimFree(waveId)
      if (!claim.claimed) {
        return claim.reason === 'over_cap' ? 'paused_at_cap' : 'refused'
      }
    }
    const sent = await this.client.outreach.findUniqueOrThrow({
      where: { managedPanelWaveId: waveId },
      select: { scheduledLocalDate: true },
    })
    const sendDate = sent.scheduledLocalDate ?? nextManagedSendDate(now)
    await this.client.managedPanelWave.updateMany({
      where: { id: waveId, sentAt: null },
      data: {
        sentAt: now,
        replyWindowEndsAt: addDays(parseISO(sendDate), MANAGED_WAVE_REPLY_DAYS),
      },
    })
    return 'sent'
  }

  // The wave's send as an unpaid Serve text draft of the approved invite,
  // counted the way a draft is. Null when the list reaches nobody, whose
  // wave is dropped so its people stay drawable.
  private async createSend(
    enrollment: Enrollment,
    waveId: string,
    now: Date,
  ): Promise<WaveSend | null> {
    assertManagedPanelInvite(enrollment.inviteMessage)
    const scheduledLocalDate = nextManagedSendDate(now)
    assertServeSmsSendDateAllowed(scheduledLocalDate, now)
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
  ): Promise<void> {
    assertManagedPanelInvite(enrollment.inviteMessage)
    const scheduledLocalDate = nextManagedSendDate(now)
    await this.client.outreach.updateMany({
      where: {
        managedPanelWaveId: waveId,
        status: OutreachStatus.pending_payment,
        fundedBy: null,
        OR: [
          { scheduledLocalDate: { lt: scheduledLocalDate } },
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
  ): Promise<void> {
    const members = new Set(await this.memberIds(organizationSlug))
    const drawn =
      wave.voterFileFilterId === null
        ? []
        : await this.client.voterFileFilterSampleMember.findMany({
            where: { voterFileFilterId: wave.voterFileFilterId },
            select: { personId: true },
          })
    await this.client.managedPanelWave.updateMany({
      where: { id: wave.id, closedAt: null },
      data: {
        closedAt: now,
        joinedMembers: drawn.filter((row) => members.has(row.personId)).length,
      },
    })
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
    await this.model.updateMany({
      where: { id: enrollmentId, status: ManagedCivicPanelStatus.building },
      data:
        status === ManagedCivicPanelStatus.ready
          ? { status, readyAt: now }
          : { status },
    })
    return status
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
    'Ask them what they think before your next vote.',
    '',
    `See your civic panel: ${APP_ROOT}${CIVIC_PANEL_PAGE_HREF}`,
    '',
    'GoodParty.org',
  ].join('\n')
