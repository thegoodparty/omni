import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  forwardRef,
  Inject,
  Injectable,
} from '@nestjs/common'
import {
  PLAN_PRICING,
  PlanPurchaseMetadataSchema,
  PlanReceipt,
  planEndsAt,
} from '@goodparty_org/contracts'
import Stripe from 'stripe'
import { z } from 'zod'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { FeaturesService } from '@/features/services/features.service'
import {
  Campaign,
  CampaignPlanLevel,
  CampaignPlanPurchaseKind,
  CampaignPlanPurchaseStatus,
  PlanPricingModel,
} from 'src/generated/prisma'
import { PurchaseHandler } from 'src/payments/purchase.types'
import { PaymentEventsService } from 'src/payments/services/paymentEventsService'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { WIN_PER_CAMPAIGN_PRICING_FLAG } from 'src/shared/util/winPerCampaignPricingFlag.util'
import { WrapperType } from 'src/shared/types/utility.types'
import { UsersService } from 'src/users/services/users.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import { isActiveCampaign } from '../util/eligibility.util'
import { CampaignsService } from '../services/campaigns.service'
import { holdsOneTimePlan } from './planState.util'

// Checkout metadata arrives as numbers from PurchaseService and as strings
// from the Stripe session at fulfillment, so the ids are coerced.
// calculateAmount gets no userId, and getProductName only the client's
// metadata, so each reads just what it is given.
const PricedPlanSchema = PlanPurchaseMetadataSchema.extend({
  campaignId: z.coerce.number().int().positive(),
})
const BuyerPlanSchema = PricedPlanSchema.extend({
  userId: z.coerce.number().int().positive(),
})
const PlanOnlySchema = PlanPurchaseMetadataSchema.pick({ plan: true })

const PLAN_RANK: Record<CampaignPlanLevel, number> = {
  free: 0,
  pro: 1,
  team: 2,
}

const TEAM_UPGRADE_CENTS = PLAN_PRICING.teamCents - PLAN_PRICING.proCents

// A plan whose access ended (expiry, or a canceled subscription) no longer
// counts as held, whatever `plan` still says.
const heldPlan = (
  campaign: Pick<Campaign, 'plan' | 'planEndedAt'>,
): CampaignPlanLevel =>
  campaign.planEndedAt ? CampaignPlanLevel.free : campaign.plan

// A subscriber from before the plan columns shipped has plan = free and no
// pricing model, so the columns alone cannot see them. The subscription id and
// isPro say they are paying; a one-time plan outranks a stray subscription on
// the same campaign, so that campaign stays upgradeable.
const onLiveSubscription = (
  campaign: Pick<
    Campaign,
    'planPricingModel' | 'planEndedAt' | 'plan' | 'isPro' | 'details'
  >,
) => {
  if (holdsOneTimePlan(campaign)) {
    return false
  }
  if (
    campaign.planPricingModel === PlanPricingModel.subscription &&
    !campaign.planEndedAt
  ) {
    return true
  }
  const details = campaign.details
  return (
    campaign.isPro &&
    typeof details === 'object' &&
    details !== null &&
    !Array.isArray(details) &&
    Boolean(details.subscriptionId)
  )
}

const parseMetadata = <T extends z.ZodType>(
  schema: T,
  rawMetadata: unknown,
): z.infer<T> => {
  const result = schema.safeParse(rawMetadata)
  if (!result.success) {
    throw new BadRequestException(result.error.message)
  }
  return result.data
}

type FulfillOutcome =
  | { kind: 'fulfilled'; upgradeFrom: CampaignPlanLevel }
  | { kind: 'refunded' }
  | { kind: 'alreadyRecorded'; reapplyPro: boolean }

@Injectable()
export class CampaignPlanPurchaseService
  extends createPrismaBase(MODELS.CampaignPlanPurchase)
  implements PurchaseHandler<unknown>
{
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly users: UsersService,
    private readonly features: FeaturesService,
    private readonly stripe: StripeService,
    private readonly analytics: AnalyticsService,
    @Inject(forwardRef(() => PaymentEventsService))
    private readonly paymentEvents: WrapperType<PaymentEventsService>,
  ) {
    super()
  }

  async validatePurchase(rawMetadata: unknown): Promise<void> {
    const { campaignId, plan, userId } = parseMetadata(
      BuyerPlanSchema,
      rawMetadata,
    )

    const enabled = await this.features.isFeatureEnabled({
      user: userId,
      feature: WIN_PER_CAMPAIGN_PRICING_FLAG,
    })
    if (!enabled) {
      throw new ForbiddenException({
        message: 'Plans are not available yet',
        errorCode: 'PLANS_NOT_AVAILABLE',
      })
    }

    const campaign = await this.campaigns.findUniqueOrThrow({
      where: { id: campaignId },
      include: { organization: { select: { ownerId: true } } },
    })

    // Owner only, unlike the manager-allowed one-time purchases (ENG-10819):
    // the plan decides what the whole team gets, so it is the owner's call.
    if (campaign.organization.ownerId !== userId) {
      throw new ForbiddenException({
        message: 'Only the campaign owner can change its plan',
        errorCode: 'NOT_CAMPAIGN_OWNER',
      })
    }

    if (!isActiveCampaign(campaign, new Date())) {
      throw new BadRequestException({
        message: 'This campaign is not active',
        errorCode: 'NO_ACTIVE_CAMPAIGN',
      })
    }

    if (onLiveSubscription(campaign)) {
      throw new ConflictException({
        message: 'This campaign is on a Pro subscription',
        errorCode: 'SUBSCRIPTION_PLAN',
      })
    }

    if (PLAN_RANK[plan] <= PLAN_RANK[heldPlan(campaign)]) {
      throw new ConflictException({
        message: 'This campaign already has this plan',
        errorCode: 'ALREADY_ON_PLAN',
      })
    }
  }

  async calculateAmount(rawMetadata: unknown): Promise<number> {
    const { campaignId, plan } = parseMetadata(PricedPlanSchema, rawMetadata)
    if (plan === CampaignPlanLevel.pro) {
      return PLAN_PRICING.proCents
    }
    const campaign = await this.campaigns.findUniqueOrThrow({
      where: { id: campaignId },
    })
    return heldPlan(campaign) === CampaignPlanLevel.pro
      ? TEAM_UPGRADE_CENTS
      : PLAN_PRICING.teamCents
  }

  getProductName(rawMetadata: unknown): string {
    const { plan } = parseMetadata(PlanOnlySchema, rawMetadata)
    return plan === CampaignPlanLevel.team ? 'Team plan' : 'Pro plan'
  }

  async getLatestReceipt(campaign: Campaign): Promise<PlanReceipt> {
    const purchase = await this.model.findFirst({
      where: {
        campaignId: campaign.id,
        status: CampaignPlanPurchaseStatus.paid,
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!purchase) {
      throw new NotFoundException('No plan purchase on record')
    }

    let session: Stripe.Checkout.Session
    try {
      session = await this.stripe.retrieveCheckoutSessionWithCharge(
        purchase.stripeCheckoutSessionId,
      )
    } catch (error) {
      this.logger.error(
        { error, sessionId: purchase.stripeCheckoutSessionId },
        'Failed to read the plan receipt from Stripe',
      )
      throw new BadGatewayException('Could not load the receipt from Stripe')
    }
    const charge =
      typeof session.payment_intent === 'object' &&
      typeof session.payment_intent?.latest_charge === 'object'
        ? session.payment_intent.latest_charge
        : null
    const card = charge?.payment_method_details?.card

    return {
      amountCents: purchase.amountCents,
      paidAt: purchase.createdAt.toISOString(),
      cardBrand: card?.brand ?? null,
      cardLast4: card?.last4 ?? null,
      receiptUrl: charge?.receipt_url ?? null,
      planEndsAt: planEndsAt(campaign)?.toISOString() ?? null,
    }
  }

  // Runs from both the client's complete call and the webhook, and
  // validatePurchase does not run at completion, so every check that matters
  // is repeated here under the campaign row lock.
  async handlePlanPostPurchase(
    sessionId: string,
    rawMetadata: unknown,
  ): Promise<void> {
    const { campaignId, plan, userId } = parseMetadata(
      BuyerPlanSchema,
      rawMetadata,
    )

    let session: Stripe.Checkout.Session
    try {
      session = await this.stripe.retrieveCheckoutSessionWithCharge(sessionId)
    } catch (error) {
      this.logger.error(
        { error, sessionId },
        'Failed to read the plan checkout session',
      )
      throw new BadGatewayException('Failed to read the checkout session')
    }

    const paymentIntent =
      typeof session.payment_intent === 'string' ? null : session.payment_intent
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (paymentIntent?.id ?? null)
    const charge =
      paymentIntent && typeof paymentIntent.latest_charge === 'object'
        ? paymentIntent.latest_charge
        : null
    const paymentMethodType = charge?.payment_method_details?.type ?? null
    const sessionCustomerId =
      typeof session.customer === 'string'
        ? session.customer
        : (session.customer?.id ?? null)

    // The session was priced for the plan the campaign held when it opened.
    // The line item's undiscounted amount says which price it was, so the
    // purchase can be checked against the plan held now.
    const isTeamUpgrade =
      plan === CampaignPlanLevel.team &&
      session.amount_subtotal === TEAM_UPGRADE_CENTS
    const pricedFrom = isTeamUpgrade
      ? CampaignPlanLevel.pro
      : CampaignPlanLevel.free
    const kind = isTeamUpgrade
      ? CampaignPlanPurchaseKind.team_upgrade
      : CampaignPlanPurchaseKind.plan
    const creditGrantedCents =
      kind === CampaignPlanPurchaseKind.plan
        ? PLAN_PRICING.includedCreditCents
        : 0

    const purchaseRow = {
      campaignId,
      buyerUserId: userId,
      kind,
      plan,
      amountCents: session.amount_total ?? 0,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId,
      paymentMethodType,
    }

    const outcome = await this.client.$transaction(
      async (tx): Promise<FulfillOutcome> => {
        await tx.$queryRaw`SELECT id FROM campaign WHERE id = ${campaignId} FOR UPDATE`
        const campaign = await tx.campaign.findUniqueOrThrow({
          where: { id: campaignId },
        })

        // The unique session id is the idempotency guard. A session a promo
        // code covered in full has no PaymentIntent, so completeCheckoutSession
        // has no marker to skip a second completion with.
        const existing = await tx.campaignPlanPurchase.findUnique({
          where: { stripeCheckoutSessionId: sessionId },
        })
        if (existing) {
          return {
            kind: 'alreadyRecorded',
            reapplyPro:
              existing.status === CampaignPlanPurchaseStatus.paid &&
              heldPlan(campaign) !== CampaignPlanLevel.free,
          }
        }

        // Two tabs both paid, or the Pro under a Team upgrade was refunded
        // before the upgrade was paid: the campaign no longer holds the plan
        // this session was priced for. First fulfilled wins; this payment is
        // refunded and recorded as such. The refund runs under the lock so the
        // row and the money move together; a failed refund rolls the row back
        // and the retry replays the same idempotency key.
        if (heldPlan(campaign) !== pricedFrom || onLiveSubscription(campaign)) {
          if (paymentIntentId) {
            try {
              await this.stripe.refundPaymentIntent(
                paymentIntentId,
                `plan-dup-refund-${sessionId}`,
              )
            } catch (error) {
              this.logger.error(
                { error, campaignId, sessionId, paymentIntentId },
                'Failed to refund a duplicate plan checkout',
              )
              throw new BadGatewayException(
                'Failed to refund the duplicate plan payment',
              )
            }
          }
          await tx.campaignPlanPurchase.create({
            data: {
              ...purchaseRow,
              status: CampaignPlanPurchaseStatus.refunded,
              refundedAt: new Date(),
            },
          })
          return { kind: 'refunded' }
        }

        await tx.campaignPlanPurchase.create({
          data: { ...purchaseRow, creditGrantedCents },
        })
        await tx.campaign.update({
          where: { id: campaignId },
          data: {
            plan,
            planPricingModel: PlanPricingModel.one_time,
            planPaidAt: campaign.planPaidAt ?? new Date(),
            planEndedAt: null,
            ...(creditGrantedCents > 0 && {
              outreachCreditCents: { increment: creditGrantedCents },
            }),
          },
        })
        return { kind: 'fulfilled', upgradeFrom: pricedFrom }
      },
      // The duplicate path holds the lock across a Stripe refund.
      { timeout: 20_000 },
    )

    // The plan session creates a Stripe Customer when the buyer had none;
    // portal-session reads it from the user's metadata.
    if (sessionCustomerId) {
      await this.users.setCustomerIdIfAbsent(userId, sessionCustomerId)
    }

    if (outcome.kind === 'refunded') {
      this.logger.warn(
        { campaignId, userId, sessionId, paymentIntentId },
        'Refunded a plan checkout for a plan the campaign no longer fits',
      )
      throw new ConflictException({
        message:
          'This campaign already has this plan, so we refunded this payment',
        errorCode: 'ALREADY_ON_PLAN',
      })
    }

    // A recorded purchase still re-applies isPro, so a crash between the
    // commit above and the flip below heals on the next completion.
    if (outcome.kind === 'alreadyRecorded' && !outcome.reapplyPro) {
      return
    }

    const { becamePro, campaign } = await this.campaigns.setIsPro(campaignId)
    if (becamePro) {
      const user = await this.users.findUniqueOrThrow({ where: { id: userId } })
      await this.paymentEvents.onBecamePro(campaign, user)
    }

    if (outcome.kind === 'fulfilled') {
      await this.trackPlanPurchase(userId, plan, outcome.upgradeFrom, {
        paymentMethodType,
        sessionId,
      })
    }
  }

  private async trackPlanPurchase(
    userId: number,
    plan: CampaignPlanLevel,
    upgradeFrom: CampaignPlanLevel,
    {
      paymentMethodType,
      sessionId,
    }: { paymentMethodType: string | null; sessionId: string },
  ) {
    try {
      await this.analytics.track(userId, EVENTS.Account.ProUpgradeComplete, {
        plan,
        pricingModel: 'oneTime',
        paymentMethod: paymentMethodType,
        upgradeFrom,
      })
      await this.analytics.identify(userId, { plan })
    } catch (error) {
      this.logger.error(
        { error, userId, sessionId },
        'Failed to track the plan purchase',
      )
    }
  }
}
