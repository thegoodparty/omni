import { Injectable } from '@nestjs/common'
import {
  ManagedCivicPanelStatus,
  OutreachFunding,
  OutreachStatus,
  OutreachType,
  Prisma,
} from '@/generated/prisma'
import { FeaturesService } from '@/features/services/features.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { SERVE_CITIZEN_PANELS_FLAG } from '@/shared/util/serveCitizenPanelsFlag.util'
import { SlackService } from '@/vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageType,
} from '@/vendors/slack/slackService.types'
import { recordManagedPanelFundingAlarm } from '../observability/managedPanelFunding.metrics'

const FIRST_SEND_SEQ = 1

// The `serve-managed-panel-unfunded-send-refused` alert message tells the
// responder to search for this line. Change both together.
export const UNFUNDED_SEND_REFUSED_LOG =
  'CRITICAL managed panel funding: unfunded text send refused'

export type TextSendUnfundedReason =
  | 'unpaid'
  | 'flag_off'
  | 'no_managed_wave'
  | 'not_serve_text'
  | 'wrong_org'
  | 'enrollment_stopped'
  | 'unpaid_expansion'
  // Missing, or not `pending`: the delivery claim refuses it anyway, so it
  // is not a funding question and raises no alarm.
  | 'not_sendable'

export type TextSendFunding =
  | { funded: true; via: 'checkout' | 'managed_pilot' }
  | { funded: false; reason: TextSendUnfundedReason }

/**
 * What a text send may claim from, as a filter the delivery layer adds to its
 * own `pending -> in_progress` claim: paid at checkout, or a free managed
 * wave whose enrollment is not stopped. The org match and the approver's
 * flag cannot be written as a filter; `check` holds that half.
 */
export const fundedTextSendWhere = (): Prisma.OutreachWhereInput => ({
  OR: [
    { stripeCheckoutSessionId: { not: null } },
    {
      fundedBy: OutreachFunding.goodparty_pilot,
      campaignId: null,
      outreachType: OutreachType.text,
      managedPanelWave: {
        is: {
          enrollment: { status: { not: ManagedCivicPanelStatus.stopped } },
        },
      },
    },
  ],
})

/**
 * The second gate on free sends, at the last moment before a human gets the
 * recipient CSV. A text goes out only if it was paid for at checkout or is a
 * live managed civic panel wave; everything else is refused, counted on the
 * funding alarm metric, logged at CRITICAL and posted to staff.
 *
 * Every Serve text, poll and round 2 row reaches `pending` through the
 * SERVE_TEXT purchase claim, which stamps the checkout session, and an
 * expansion stamps its own. A Serve text can never price at zero (a row with
 * no recipient count is refused at checkout), so the free-purchase path never
 * reaches one, and no legitimate send arrives here with neither.
 */
@Injectable()
export class OutreachTextSendFundingService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(
    private readonly slack: SlackService,
    private readonly features: FeaturesService,
  ) {
    super()
  }

  async check(outreachId: number, sendSeq: number): Promise<TextSendFunding> {
    if (sendSeq > FIRST_SEND_SEQ) {
      const expansion = await this.client.outreachPollExpansion.findFirst({
        where: { outreachId, sendSeq },
        select: { status: true, stripeCheckoutSessionId: true },
      })
      if (expansion?.status !== OutreachStatus.pending) {
        return { funded: false, reason: 'not_sendable' }
      }
      return expansion.stripeCheckoutSessionId
        ? { funded: true, via: 'checkout' }
        : { funded: false, reason: 'unpaid_expansion' }
    }

    const row = await this.model.findUnique({
      where: { id: outreachId },
      select: {
        campaignId: true,
        organizationSlug: true,
        outreachType: true,
        status: true,
        stripeCheckoutSessionId: true,
        fundedBy: true,
        managedPanelWave: {
          select: {
            enrollment: {
              select: {
                organizationSlug: true,
                status: true,
                approvedByUserId: true,
              },
            },
          },
        },
      },
    })
    if (row?.status !== OutreachStatus.pending) {
      return { funded: false, reason: 'not_sendable' }
    }
    if (row.stripeCheckoutSessionId) return { funded: true, via: 'checkout' }
    if (row.fundedBy !== OutreachFunding.goodparty_pilot) {
      return { funded: false, reason: 'unpaid' }
    }
    const enrollment = row.managedPanelWave?.enrollment
    if (!enrollment) return { funded: false, reason: 'no_managed_wave' }
    if (row.campaignId !== null || row.outreachType !== OutreachType.text) {
      return { funded: false, reason: 'not_serve_text' }
    }
    if (enrollment.organizationSlug !== row.organizationSlug) {
      return { funded: false, reason: 'wrong_org' }
    }
    if (enrollment.status === ManagedCivicPanelStatus.stopped) {
      return { funded: false, reason: 'enrollment_stopped' }
    }
    // serve-citizen-panels is the only switch on free sends: off for the
    // official who approved the panel, and nothing of theirs goes out free.
    const flagOn =
      enrollment.approvedByUserId !== null &&
      (await this.features.isFeatureEnabled({
        user: enrollment.approvedByUserId,
        feature: SERVE_CITIZEN_PANELS_FLAG,
      }))
    if (!flagOn) return { funded: false, reason: 'flag_off' }
    return { funded: true, via: 'managed_pilot' }
  }

  async reportRefusal(
    outreachId: number,
    sendSeq: number,
    reason: TextSendUnfundedReason,
  ): Promise<void> {
    recordManagedPanelFundingAlarm('send_refused')
    this.logger.error(
      { outreachId, sendSeq, reason },
      UNFUNDED_SEND_REFUSED_LOG,
    )
    try {
      await this.slack.message(
        {
          blocks: [
            {
              type: SlackMessageType.HEADER,
              text: {
                type: SlackMessageType.PLAIN_TEXT,
                text: 'Unfunded text send refused',
                emoji: true,
              },
            },
            {
              type: SlackMessageType.SECTION,
              text: {
                type: SlackMessageType.MRKDWN,
                text:
                  `*Outreach*: ${outreachId}, send ${sendSeq}` +
                  `\n*Reason*: ${reason}` +
                  '\nNothing was handed off. It was neither paid at ' +
                  'checkout nor a live managed civic panel wave.',
              },
            },
          ],
        },
        SlackChannel.botTevynApi,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId, sendSeq },
        'Unfunded send refusal notice failed',
      )
    }
  }
}
