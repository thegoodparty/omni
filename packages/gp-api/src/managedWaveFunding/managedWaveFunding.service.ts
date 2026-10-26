import { Injectable } from '@nestjs/common'
import {
  CivicPanelStatus,
  ContactStatusField,
  ManagedCivicPanelStatus,
  OutreachFunding,
  OutreachStatus,
  OutreachType,
} from '@/generated/prisma'
import { AnalyticsService } from '@/analytics/analytics.service'
import { managedPanelStatusChanged } from '@/contacts/utils/managedPanelAnalytics.util'
import { FeaturesService } from '@/features/services/features.service'
import { trackForOffice } from '@/priorities/util/priorityAnalytics.util'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from '@/queue/queue.types'
import { SERVE_CITIZEN_PANELS_FLAG } from '@/shared/util/serveCitizenPanelsFlag.util'
import { SlackService } from '@/vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageType,
} from '@/vendors/slack/slackService.types'

const INITIAL_SEND_SEQ = 1

export type FreeClaimRefusal =
  | 'wave_not_found'
  | 'no_outreach'
  | 'not_serve_text'
  | 'not_pending_payment'
  | 'has_checkout_session'
  | 'already_funded'
  | 'wrong_org'
  | 'not_building'
  | 'not_approved'
  | 'flag_off'
  | 'not_the_approved_invite'
  | 'no_text_count'
  | 'over_cap'
  | 'lost_race'

export type FreeClaimResult =
  | {
      claimed: true
      outreachId: number
      organizationSlug: string
      textCount: number
      // True when this call found its own earlier claim still `pending` and
      // enqueued it again without spending more texts.
      resumed: boolean
    }
  | { claimed: false; reason: FreeClaimRefusal }

class Refused extends Error {
  constructor(readonly reason: FreeClaimRefusal) {
    super(reason)
  }
}

/**
 * The only code that may make a send free. A managed civic panel wave's
 * outreach is claimed `pending_payment -> pending` with `fundedBy` set,
 * exactly as a paid SERVE_TEXT is claimed after checkout, but only when every
 * condition below holds inside one transaction.
 *
 * NO ROUTE, NO CHAT TOOL, NO WEBAPP-REACHABLE CALLER. It takes an internal
 * wave id and is reached only from the wave job. `managedWaveFunding.imports
 * .test.ts` fails the build if anything else imports this file.
 */
@Injectable()
export class ManagedWaveFundingService extends createPrismaBase(
  MODELS.ManagedPanelWave,
) {
  constructor(
    private readonly features: FeaturesService,
    private readonly queueProducer: QueueProducerService,
    private readonly slack: SlackService,
    private readonly organizations: OrganizationsService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  async claimFree(waveId: string): Promise<FreeClaimResult> {
    const result = await this.claim(waveId)
    if (!result.claimed) {
      this.logger.warn({ waveId, reason: result.reason }, 'Free claim refused')
      if (result.reason === 'over_cap') await this.pauseAtCap(waveId)
      return result
    }

    try {
      await this.enqueueSend(result.outreachId)
    } catch (error) {
      // A resumed claim stays claimed, so the next attempt resumes it again
      // rather than counting its texts a second time.
      if (!result.resumed) {
        await this.revert(waveId, result.outreachId, result.textCount)
      }
      this.logger.error(
        { error, waveId, outreachId: result.outreachId },
        'Free managed wave could not be enqueued; claim reverted',
      )
      throw error
    }

    this.logger.info(
      { waveId, outreachId: result.outreachId, textCount: result.textCount },
      'Free managed wave claimed and enqueued',
    )
    await this.notify(
      'Managed civic panel pilot wave queued (free, no checkout)',
      result.organizationSlug,
      [
        `*Outreach*: ${result.outreachId}`,
        `*Wave*: ${waveId}`,
        `*Recipients*: ${result.textCount}`,
        'GoodParty is paying for this send as part of the managed civic ' +
          'panel pilot. The recipient CSV follows as usual.',
      ],
    )
    return result
  }

  private async claim(waveId: string): Promise<FreeClaimResult> {
    const approver = await this.model.findUnique({
      where: { id: waveId },
      select: { enrollment: { select: { approvedByUserId: true } } },
    })
    if (!approver) return { claimed: false, reason: 'wave_not_found' }
    const approvedByUserId = approver.enrollment.approvedByUserId
    if (approvedByUserId === null) {
      return { claimed: false, reason: 'not_approved' }
    }
    // The flag read is a network call, so it runs before the transaction
    // opens; the transaction then refuses unless the approver it was read for
    // is still the one on record.
    const flagOn = await this.features.isFeatureEnabled({
      user: approvedByUserId,
      feature: SERVE_CITIZEN_PANELS_FLAG,
    })
    if (!flagOn) return { claimed: false, reason: 'flag_off' }

    try {
      return await this.client.$transaction(async (tx) => {
        const wave = await tx.managedPanelWave.findUnique({
          where: { id: waveId },
          select: { enrollmentId: true },
        })
        if (!wave) throw new Refused('wave_not_found')
        // Serializes claims on one enrollment, so two waves cannot both fit
        // under a cap only one of them fits under, and a pause or stop waits
        // for this claim to settle.
        await tx.$queryRaw`SELECT id FROM managed_civic_panel WHERE id = ${wave.enrollmentId} FOR UPDATE`

        const enrollment = await tx.managedCivicPanel.findUniqueOrThrow({
          where: { id: wave.enrollmentId },
        })
        const outreach = await tx.outreach.findUnique({
          where: { managedPanelWaveId: waveId },
        })

        if (!outreach) throw new Refused('no_outreach')
        // An earlier claim committed but its enqueue never happened (a crash
        // between the two). Enqueue again: the deterministic dedupe id makes
        // a repeat harmless, and its texts were already counted.
        if (
          outreach.status === OutreachStatus.pending &&
          outreach.fundedBy === OutreachFunding.goodparty_pilot &&
          outreach.managedPanelWaveId === waveId &&
          outreach.organizationSlug === enrollment.organizationSlug &&
          outreach.stripeCheckoutSessionId === null &&
          outreach.textCount !== null &&
          enrollment.status === ManagedCivicPanelStatus.building
        ) {
          return {
            claimed: true as const,
            outreachId: outreach.id,
            organizationSlug: enrollment.organizationSlug,
            textCount: outreach.textCount,
            resumed: true,
          }
        }
        if (
          outreach.campaignId !== null ||
          outreach.outreachType !== OutreachType.text
        ) {
          throw new Refused('not_serve_text')
        }
        if (outreach.status !== OutreachStatus.pending_payment) {
          throw new Refused('not_pending_payment')
        }
        if (outreach.stripeCheckoutSessionId !== null) {
          throw new Refused('has_checkout_session')
        }
        if (outreach.fundedBy !== null) throw new Refused('already_funded')
        if (outreach.organizationSlug !== enrollment.organizationSlug) {
          throw new Refused('wrong_org')
        }
        if (enrollment.status !== ManagedCivicPanelStatus.building) {
          throw new Refused('not_building')
        }
        if (
          enrollment.approvedByUserId !== approvedByUserId ||
          !enrollment.consentVersion
        ) {
          throw new Refused('not_approved')
        }
        // Free sends carry only the words the official approved.
        if (outreach.message !== enrollment.inviteMessage) {
          throw new Refused('not_the_approved_invite')
        }
        const textCount = outreach.textCount
        if (textCount === null || textCount < 1) {
          throw new Refused('no_text_count')
        }
        if (textCount > enrollment.freeTextCap - enrollment.freeTextsUsed) {
          throw new Refused('over_cap')
        }

        const used = await tx.managedCivicPanel.updateMany({
          where: {
            id: enrollment.id,
            status: ManagedCivicPanelStatus.building,
            freeTextsUsed: enrollment.freeTextsUsed,
          },
          data: { freeTextsUsed: { increment: textCount } },
        })
        // The same compare-and-swap the SERVE_TEXT purchase claim makes,
        // narrowed to the facts checked above so a write between the read
        // and here matches nothing.
        const claimed = await tx.outreach.updateMany({
          where: {
            id: outreach.id,
            managedPanelWaveId: waveId,
            organizationSlug: enrollment.organizationSlug,
            campaignId: null,
            outreachType: OutreachType.text,
            status: OutreachStatus.pending_payment,
            stripeCheckoutSessionId: null,
            fundedBy: null,
          },
          data: {
            status: OutreachStatus.pending,
            fundedBy: OutreachFunding.goodparty_pilot,
            billableTextCount: textCount,
          },
        })
        if (used.count !== 1 || claimed.count !== 1) {
          throw new Refused('lost_race')
        }
        return {
          claimed: true as const,
          outreachId: outreach.id,
          organizationSlug: enrollment.organizationSlug,
          textCount,
          resumed: false,
        }
      })
    } catch (error) {
      if (error instanceof Refused) {
        return { claimed: false, reason: error.reason }
      }
      throw error
    }
  }

  // Undoes the claim in one write so the wave can be claimed again: the row
  // back to an unfunded draft and its texts back under the cap. Guarded on
  // the claim's own state, so it can never clobber a later move.
  private async revert(
    waveId: string,
    outreachId: number,
    textCount: number,
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const wave = await tx.managedPanelWave.findUnique({
        where: { id: waveId },
        select: { enrollmentId: true },
      })
      if (!wave) return
      // Same lock order as the claim, so a claim on this enrollment waits
      // for the whole revert rather than interleaving with it.
      await tx.$queryRaw`SELECT id FROM managed_civic_panel WHERE id = ${wave.enrollmentId} FOR UPDATE`
      const reverted = await tx.outreach.updateMany({
        where: {
          id: outreachId,
          managedPanelWaveId: waveId,
          status: OutreachStatus.pending,
          fundedBy: OutreachFunding.goodparty_pilot,
        },
        data: {
          status: OutreachStatus.pending_payment,
          fundedBy: null,
          billableTextCount: null,
        },
      })
      if (reverted.count === 0) return
      await tx.managedCivicPanel.updateMany({
        where: { id: wave.enrollmentId },
        data: { freeTextsUsed: { decrement: textCount } },
      })
    })
  }

  private async enqueueSend(outreachId: number): Promise<void> {
    await this.queueProducer.sendMessage(
      {
        type: QueueType.OUTREACH_TEXT_SEND,
        data: { outreachId, sendSeq: INITIAL_SEND_SEQ },
      },
      `${MessageGroup.outreachTextSend}-${outreachId}`,
      {
        throwOnError: true,
        deduplicationId: `${QueueType.OUTREACH_TEXT_SEND}-${outreachId}-${INITIAL_SEND_SEQ}`,
      },
    )
  }

  // A wave that does not fit what is left of the cap pauses the build, so
  // nothing keeps drawing waves that can never be claimed free. Staff decide
  // whether to raise the cap.
  private async pauseAtCap(waveId: string): Promise<void> {
    // Re-checked under the claim's lock: a sibling claim reverted since the
    // refusal may have handed texts back, and then the wave fits after all.
    const paused = await this.client.$transaction(async (tx) => {
      const wave = await tx.managedPanelWave.findUnique({
        where: { id: waveId },
        select: {
          enrollmentId: true,
          outreach: { select: { textCount: true } },
        },
      })
      if (!wave) return null
      await tx.$queryRaw`SELECT id FROM managed_civic_panel WHERE id = ${wave.enrollmentId} FOR UPDATE`
      const enrollment = await tx.managedCivicPanel.findUniqueOrThrow({
        where: { id: wave.enrollmentId },
      })
      const textCount = wave.outreach?.textCount ?? 0
      if (
        enrollment.status !== ManagedCivicPanelStatus.building ||
        textCount <= enrollment.freeTextCap - enrollment.freeTextsUsed
      ) {
        return null
      }
      await tx.managedCivicPanel.update({
        where: { id: enrollment.id },
        data: { status: ManagedCivicPanelStatus.paused, pausedAt: new Date() },
      })
      return enrollment
    })
    if (!paused) return
    const members = await this.client.contactCurrentStatus.count({
      where: {
        organizationSlug: paused.organizationSlug,
        field: ContactStatusField.civic_panel,
        value: CivicPanelStatus.member,
      },
    })
    void trackForOffice(
      this.client,
      this.analytics,
      { organizationSlug: paused.organizationSlug },
      [
        managedPanelStatusChanged({
          from: ManagedCivicPanelStatus.building,
          to: ManagedCivicPanelStatus.paused,
          members,
          changedBy: 'system',
        }),
      ],
    )
    this.logger.warn(
      { waveId, organizationSlug: paused.organizationSlug },
      'Managed civic panel paused at its free text cap',
    )
    await this.notify(
      'Managed civic panel paused at its free text cap',
      paused.organizationSlug,
      [
        `*Free texts used*: ${paused.freeTextsUsed} of ${paused.freeTextCap}`,
        `*Wave*: ${waveId} did not fit and was not sent`,
      ],
    )
  }

  // Routine notices for staff. A failure here never undoes a claim that has
  // already been enqueued.
  private async notify(
    header: string,
    organizationSlug: string,
    lines: string[],
  ): Promise<void> {
    try {
      const office = await this.organizations
        .resolvePositionNameByOrganizationSlug(organizationSlug)
        .catch(() => null)
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
              text: {
                type: SlackMessageType.MRKDWN,
                text: [
                  `*Office*: ${office ?? 'unknown'} (${organizationSlug})`,
                  ...lines,
                ].join('\n'),
              },
            },
          ],
        },
        SlackChannel.botTevynApi,
      )
    } catch (err) {
      this.logger.error({ err, header }, 'Managed panel notice failed')
    }
  }
}
