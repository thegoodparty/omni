import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common'
import {
  AdminExtendPlan,
  AdminRefundPlanResponse,
  AdminSetPlan,
  CampaignPlanState,
  planEndsAt,
} from '@goodparty_org/contracts'
import { differenceInDays } from 'date-fns'
import { AdminUpdateCampaignSchema } from './schemas/adminUpdateCampaign.schema'
import {
  Campaign,
  CampaignPlanLevel,
  CampaignPlanPurchaseKind,
  CampaignPlanPurchaseStatus,
  ElectedOfficeWinSource,
  OutreachStatus,
  PlanPricingModel,
  Prisma,
} from '../../generated/prisma'
import { WinOfficeService } from '@/electedOffice/services/winOffice.service'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { VoterFileDownloadAccessService } from '../../shared/services/voterFileDownloadAccess.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { PinoLogger } from 'nestjs-pino'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'

const DELETE_CAMPAIGN_TX_TIMEOUT_MS = 60_000

const toPlanState = (campaign: Campaign): CampaignPlanState => ({
  plan: campaign.plan,
  planPricingModel: campaign.planPricingModel,
  planPaidAt: campaign.planPaidAt?.toISOString() ?? null,
  planEndsAt: planEndsAt(campaign)?.toISOString() ?? null,
  planEndedAt: campaign.planEndedAt?.toISOString() ?? null,
  outreachCreditCents: campaign.outreachCreditCents,
})

@Injectable()
export class AdminCampaignsService {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly voterFileDownloadAccess: VoterFileDownloadAccessService,
    private readonly analytics: AnalyticsService,
    private readonly organizations: OrganizationsService,
    private readonly stripe: StripeService,
    private readonly winOffices: WinOfficeService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminCampaignsService.name)
  }

  async update(id: number, body: AdminUpdateCampaignSchema) {
    const { isVerified, didWin, tier } = body
    const attributes: Prisma.CampaignUpdateInput = {}

    if (typeof isVerified !== 'undefined') {
      attributes.isVerified = isVerified
      attributes.dateVerified = isVerified === null ? null : new Date()
    }
    if (typeof didWin !== 'undefined') {
      attributes.didWin = didWin
    }
    if (typeof tier !== 'undefined') {
      attributes.tier = tier
    }

    const updatedCampaign = await this.campaigns.update({
      where: { id },
      data: attributes,
    })

    if (typeof didWin !== 'undefined') {
      await this.winOffices.reconcile(id, ElectedOfficeWinSource.staff)
    }

    return updatedCampaign
  }

  // A comp is the same transition as a paid plan, so it goes through setIsPro
  // (the only writer of isPro) and writes the plan columns in the same commit.
  // A comp leaves no purchase row, which is what keeps it out of the refund
  // endpoint.
  async setPlan(id: number, body: AdminSetPlan): Promise<CampaignPlanState> {
    const { plan, creditCents } = body
    const paid = plan !== CampaignPlanLevel.free
    const existing = await this.campaigns.findUniqueOrThrow({
      where: { id },
      select: { id: true, details: true },
    })
    // Free would leave Stripe billing a campaign the product shows as free
    // (ENG-10660), so staff cancel the subscription first.
    if (!paid && existing.details?.subscriptionId) {
      throw new ConflictException({
        message: 'Cancel the Stripe subscription before setting Free',
        errorCode: 'ACTIVE_SUBSCRIPTION',
      })
    }

    const { campaign } = await this.campaigns.setIsPro(id, paid, true, {
      plan,
      planPricingModel: paid ? PlanPricingModel.one_time : null,
      planEndedAt: null,
      ...(creditCents !== undefined && { outreachCreditCents: creditCents }),
    })

    if (paid) {
      await this.track(
        campaign.userId,
        EVENTS.Account.ProSubscriptionConfirmed,
        {
          price: 0,
          paymentMethod: 'admin',
        },
      )
    }
    return toPlanState(campaign)
  }

  async extendPlan(
    id: number,
    { endsAt, reason }: AdminExtendPlan,
  ): Promise<CampaignPlanState> {
    const existing = await this.campaigns.findUniqueOrThrow({ where: { id } })
    if (existing.plan === CampaignPlanLevel.free) {
      throw new BadRequestException({
        message: 'This campaign has no plan to extend',
        errorCode: 'NO_PLAN_TO_EXTEND',
      })
    }

    const override = endsAt ? new Date(endsAt) : null
    const reopens =
      existing.planEndedAt !== null &&
      override !== null &&
      override.getTime() > Date.now()

    const campaign = reopens
      ? (
          await this.campaigns.setIsPro(id, true, true, {
            planEndsAtOverride: override,
            planEndedAt: null,
          })
        ).campaign
      : await this.campaigns.update({
          where: { id },
          data: { planEndsAtOverride: override },
        })

    await this.track(campaign.userId, EVENTS.Account.PaidPlanUpdated, {
      change: 'extended',
      reason,
    })
    return toPlanState(campaign)
  }

  // Stripe goes first and is keyed on the purchase, so a retry after any
  // later failure replays the same refund instead of issuing a second one,
  // and finishes the writes below. The campaign write rides setIsPro because
  // it is the only way to write isPro, which means it cannot share a
  // transaction with the purchase row; the row is marked last for that reason.
  async refundPlan(id: number): Promise<AdminRefundPlanResponse> {
    const campaign = await this.campaigns.findUniqueOrThrow({ where: { id } })
    const purchase = await this.campaigns.client.campaignPlanPurchase.findFirst(
      {
        where: { campaignId: id, status: CampaignPlanPurchaseStatus.paid },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      },
    )
    if (!purchase) {
      throw new ConflictException({
        message: 'This campaign has no paid plan purchase to refund',
        errorCode: 'NO_REFUNDABLE_PURCHASE',
      })
    }

    const backToPro = purchase.kind === CampaignPlanPurchaseKind.team_upgrade
    if (!backToPro && campaign.details?.subscriptionId) {
      throw new ConflictException({
        message: 'Cancel the Stripe subscription before refunding this plan',
        errorCode: 'ACTIVE_SUBSCRIPTION',
      })
    }

    const outreachSent =
      (await this.campaigns.client.outreach.count({
        where: {
          campaignId: id,
          createdAt: { gte: purchase.createdAt },
          status: {
            in: [OutreachStatus.in_progress, OutreachStatus.completed],
          },
        },
      })) > 0
    const daysSincePurchase = differenceInDays(new Date(), purchase.createdAt)

    let refundedCents = 0
    if (purchase.stripePaymentIntentId) {
      try {
        await this.stripe.refundPaymentIntent(
          purchase.stripePaymentIntentId,
          `plan-refund-${purchase.id}`,
        )
      } catch (error) {
        this.logger.error(
          { error, campaignId: id, purchaseId: purchase.id },
          'Failed to refund a plan purchase',
        )
        throw new BadGatewayException('Failed to refund the plan payment')
      }
      refundedCents = purchase.amountCents
    }

    await this.campaigns.setIsPro(id, backToPro, true, {
      outreachCreditCents: 0,
      ...(backToPro
        ? { plan: CampaignPlanLevel.pro }
        : {
            plan: CampaignPlanLevel.free,
            planPricingModel: null,
            planPaidAt: null,
          }),
    })
    await this.campaigns.client.campaignPlanPurchase.updateMany({
      where: { id: purchase.id, status: CampaignPlanPurchaseStatus.paid },
      data: {
        status: CampaignPlanPurchaseStatus.refunded,
        refundedAt: new Date(),
      },
    })

    await this.track(campaign.userId, EVENTS.Account.PaidPlanUpdated, {
      change: 'refunded',
      reason: 'admin_refund',
    })
    return {
      refundedCents,
      eligibility: { daysSincePurchase, outreachSent },
    }
  }

  private async track(
    userId: number,
    event: string,
    properties: Record<string, string | number>,
  ) {
    try {
      await this.analytics.track(userId, event, properties)
    } catch (error) {
      this.logger.error(
        { error, userId, event },
        '[ADMIN] Failed to track admin plan analytics',
      )
    }
  }

  // details.subscriptionId is the only link from a live Pro subscription back
  // to an account, and it is deleted with the row. Deleting without a cancel
  // left Stripe billing a campaign nobody could see or cancel (ENG-11454).
  // Same ordering as UsersService.deleteUser: the delete goes first so a
  // cascade the DB refuses never reaches Stripe, and the cancel runs before
  // the commit so a Stripe failure rolls the delete back.
  async delete(id: number) {
    await this.campaigns.client.$transaction(
      async (tx) => {
        const { details } = await tx.campaign.delete({ where: { id } })
        if (details?.subscriptionId) {
          await this.stripe.cancelSubscription(details.subscriptionId)
        }
      },
      { timeout: DELETE_CAMPAIGN_TX_TIMEOUT_MS },
    )
  }

  async proNoVoterFile() {
    const campaigns = await this.campaigns.findMany({
      where: {
        NOT: {
          userId: undefined,
        },
        isPro: true,
      },
    })

    const districtResults = await Promise.allSettled(
      campaigns.map((c) =>
        c.organizationSlug
          ? this.organizations.getDistrictAndBallotLevelForOrgSlug(
              c.organizationSlug,
            )
          : null,
      ),
    )

    return campaigns.filter((campaign, i) => {
      const result = districtResults[i]
      if (!result) {
        // Settled results map 1:1 with campaigns, so this is unreachable; fail
        // closed (treat as blocked) to match the rejected/no-slug handling below.
        return true
      }
      if (result.status === 'rejected') {
        // Fail closed: if we can't resolve the authoritative level, don't let
        // canDownload fall back to the user-editable details.ballotLevel — that
        // would drop a spoofed-local FEDERAL campaign off this audit list.
        const err: unknown = result.reason
        this.logger.warn(
          { campaignId: campaign.id, err },
          'Failed to resolve district/ballotLevel for campaign — treating as blocked',
        )
        return true
      }
      const resolved = result.value
      if (resolved === null) {
        // No organizationSlug — no authoritative ballot level available, so we
        // can't confirm eligibility without trusting details.ballotLevel. Fail
        // closed, same as the rejected case above.
        return true
      }
      return !this.voterFileDownloadAccess.canDownload(
        campaign,
        resolved.district ?? null,
        resolved.ballotLevel ?? null,
      )
    })
  }
}
