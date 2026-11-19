import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { RaceOpponentService } from '@/raceOpponent/services/raceOpponent.service'
import { useTestService } from '@/test-service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { addDays, format } from 'date-fns'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckoutSessionMode, WebhookEventType } from './payments.types'

// Route-level coverage for Pro fulfilment from `customer.subscription.created`.
// `checkout.session.completed` used to be the only path that stored
// `details.subscriptionId` and flipped `isPro`, so a completion that was
// missed, delayed or lost left a paying account on the free plan with nothing
// to retry (ENG-11182, ENG-11672). A Pro checkout now stamps `userId` and
// `campaignId` onto the subscription itself, and this event can fulfil from
// that stamp, so the two sibling events are independent arms of one outcome
// rather than one arm and one formality.
//
// Delivered through the real `POST /v1/payments/events` controller against a
// real Postgres, for the same reason as the cancellation suite: the effects
// under test are rows in the campaign, and the signature can be generated with
// the same secret the app verifies against, so the event goes through
// parse -> dispatch -> handler -> DB for real.

const service = useTestService()

const WEBHOOK_ROUTE = '/v1/payments/events'

// Signing-only client. `generateTestHeaderString` is a local HMAC over the
// payload, the same computation Stripe performs before delivery and
// `StripeService.parseWebhookEvent` verifies on arrival, so no network call is
// made and no live Stripe object is touched.
const signer = new Stripe('sk_test_signing_only')

const deliverStripeEvent = (event: Record<string, unknown>) => {
  const payload = JSON.stringify(event)
  return service.client.post(WEBHOOK_ROUTE, payload, {
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signer.webhooks.generateTestHeaderString({
        payload,
        secret: process.env.STRIPE_WEBSOCKET_SECRET as string,
      }),
    },
  })
}

const nowInSeconds = () => Math.floor(Date.now() / 1000)

let eventSeq = 0

const eventEnvelope = (type: string, object: Record<string, unknown>) => {
  eventSeq += 1
  return {
    id: `evt_test_pro_fulfilment_${eventSeq}`,
    object: 'event',
    api_version: '2025-03-31.basil',
    created: nowInSeconds(),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  }
}

type SubscriptionCreatedOptions = {
  subscriptionId: string
  customerId: string
  status: Stripe.Subscription.Status
  // Absent on a subscription minted before the checkout stamped it, or by
  // anything that is not our Pro checkout.
  metadata?: Record<string, string>
}

const subscriptionCreatedEvent = ({
  subscriptionId,
  customerId,
  status,
  metadata,
}: SubscriptionCreatedOptions) =>
  eventEnvelope(WebhookEventType.CustomerSubscriptionCreated, {
    id: subscriptionId,
    object: 'subscription',
    customer: customerId,
    currency: 'usd',
    status,
    canceled_at: null,
    cancel_at: null,
    cancel_at_period_end: false,
    cancellation_details: null,
    items: { object: 'list', data: [], has_more: false, url: '' },
    ...(metadata ? { metadata } : {}),
  })

const checkoutCompletedEvent = ({
  subscriptionId,
  customerId,
  userId,
}: {
  subscriptionId: string
  customerId: string
  userId: number
}) =>
  eventEnvelope(WebhookEventType.CheckoutSessionCompleted, {
    id: 'cs_test_pro',
    object: 'checkout.session',
    mode: CheckoutSessionMode.SUBSCRIPTION,
    customer: customerId,
    subscription: subscriptionId,
    payment_status: 'paid',
    metadata: { userId: String(userId) },
  })

let campaignSeq = 0

// A campaign that passes `isActiveCampaign`, i.e. one the Pro checkout would
// have sold to: an upcoming election date and no recorded result.
const seedCampaign = async (details: Record<string, unknown> = {}) => {
  campaignSeq += 1
  const slug = `pro-fulfilment-${campaignSeq}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      slug,
      organizationSlug: slug,
      userId: service.user.id,
      details: {
        electionDate: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
        ...details,
      },
    },
  })
}

const readCampaign = (id: number) =>
  service.prisma.campaign.findUniqueOrThrow({ where: { id } })

// The dispatch is one of the one-time Pro-upgrade side effects, gated on the
// same `becamePro` transition as the flip. Only the arm that wins the race can
// fire it, so the arm that loses must not be the only one that knows about it.
const spyOnOpponentCollection = () =>
  vi
    .spyOn(service.app.get(RaceOpponentService), 'autoCollectOnProUpgrade')
    .mockResolvedValue(undefined)

beforeEach(() => {
  // `setIsPro` ends in a CRM sync and `checkout.session.completed` in two
  // candidate-facing notifications. Both are third-party calls incidental to
  // the rows under test, and the harness carries tokens for neither.
  vi.spyOn(
    service.app.get(CrmCampaignsService),
    'trackCampaign',
  ).mockResolvedValue(undefined)
  vi.spyOn(service.app.get(SlackService), 'message').mockResolvedValue(
    undefined,
  )
})

describe('POST /v1/payments/events — customer.subscription.created', () => {
  // ENG-11672: the account is billed on a live subscription while the
  // dashboard says free. Both halves matter — the link is what makes every
  // later subscription event resolvable, and the flip is what the candidate
  // sees — so they are asserted as one outcome.
  it('links the campaign and flips it Pro for an active subscription', async () => {
    const campaign = await seedCampaign()
    const opponentCollection = spyOnOpponentCollection()

    const res = await deliverStripeEvent(
      subscriptionCreatedEvent({
        subscriptionId: 'sub_pro_created',
        customerId: 'cus_pro_created',
        status: 'active',
        metadata: {
          userId: String(service.user.id),
          campaignId: String(campaign.id),
        },
      }),
    )

    expect(res.status).toBe(200)

    const updated = await readCampaign(campaign.id)
    expect(updated.details.subscriptionId).toBe('sub_pro_created')
    expect(updated.isPro).toBe(true)
    expect(updated.details.isProUpdatedAt).toBeDefined()
    // Flipping Pro without this leaves the candidate Pro with no opponent
    // research started, because the sibling completion event then computes
    // `becamePro === false` and skips its own dispatch.
    expect(opponentCollection).toHaveBeenCalledExactlyOnceWith(campaign.id)
  })

  it('flips Pro for a trialing subscription', async () => {
    const campaign = await seedCampaign()

    const res = await deliverStripeEvent(
      subscriptionCreatedEvent({
        subscriptionId: 'sub_pro_trialing',
        customerId: 'cus_pro_trialing',
        status: 'trialing',
        metadata: { userId: String(service.user.id) },
      }),
    )

    expect(res.status).toBe(200)
    expect((await readCampaign(campaign.id)).isPro).toBe(true)
  })

  // The link and the entitlement are separate decisions. A subscription that
  // has not been paid for is still worth storing — its later `updated` and
  // `deleted` events resolve through that id, and an `incomplete` one can
  // become active without a second `created` — but handing out Pro for it
  // would give the product away to every abandoned checkout.
  it.each<Stripe.Subscription.Status>([
    'incomplete',
    'past_due',
    'unpaid',
    'canceled',
  ])('links a %s subscription without flipping Pro', async (status) => {
    const campaign = await seedCampaign()
    const opponentCollection = spyOnOpponentCollection()

    const res = await deliverStripeEvent(
      subscriptionCreatedEvent({
        subscriptionId: `sub_pro_${status}`,
        customerId: `cus_pro_${status}`,
        status,
        metadata: { userId: String(service.user.id) },
      }),
    )

    expect(res.status).toBe(200)

    const updated = await readCampaign(campaign.id)
    expect(updated.details.subscriptionId).toBe(`sub_pro_${status}`)
    expect(updated.isPro).toBe(false)
    expect(opponentCollection).not.toHaveBeenCalled()
  })

  // Overwriting a different stored id is the duplicate-checkout shape
  // (ENG-11084): the subscription that was carrying the campaign keeps billing
  // with nothing pointing at it. The replay-safe direction is to leave the row
  // exactly as it was, which also means no second Pro claim.
  it('leaves a campaign that already holds a different subscriptionId untouched', async () => {
    const upgradedAt = '2026-01-15T00:00:00Z'
    const campaign = await seedCampaign({
      subscriptionId: 'sub_already_linked',
      isProUpdatedAt: upgradedAt,
    })

    const res = await deliverStripeEvent(
      subscriptionCreatedEvent({
        subscriptionId: 'sub_second_checkout',
        customerId: 'cus_second_checkout',
        status: 'active',
        metadata: { userId: String(service.user.id) },
      }),
    )

    expect(res.status).toBe(200)

    const updated = await readCampaign(campaign.id)
    expect(updated.details.subscriptionId).toBe('sub_already_linked')
    expect(updated.isPro).toBe(false)
    expect(updated.details.isProUpdatedAt).toBe(upgradedAt)
  })

  // A subscription nobody stamped at checkout proves which customer it belongs
  // to but not which campaign it was sold for, so it keeps the pre-existing
  // behaviour: linked by customer id, no entitlement granted.
  it('links by customer id without flipping Pro when the subscription carries no metadata', async () => {
    const campaign = await seedCampaign()
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { metaData: { customerId: 'cus_unstamped' } },
    })

    const res = await deliverStripeEvent(
      subscriptionCreatedEvent({
        subscriptionId: 'sub_unstamped',
        customerId: 'cus_unstamped',
        status: 'active',
      }),
    )

    expect(res.status).toBe(200)

    const updated = await readCampaign(campaign.id)
    expect(updated.details.subscriptionId).toBe('sub_unstamped')
    expect(updated.isPro).toBe(false)
  })
})

describe('POST /v1/payments/events — checkout.session.completed (regression)', () => {
  it('still fulfils Pro and stamps the upgrade once', async () => {
    const campaign = await seedCampaign()

    const res = await deliverStripeEvent(
      checkoutCompletedEvent({
        subscriptionId: 'sub_checkout_completed',
        customerId: 'cus_checkout_completed',
        userId: service.user.id,
      }),
    )

    expect(res.status).toBe(200)

    const updated = await readCampaign(campaign.id)
    expect(updated.details.subscriptionId).toBe('sub_checkout_completed')
    expect(updated.isPro).toBe(true)
    expect(updated.details.isProUpdatedAt).toBeDefined()
  })

  // Stripe delivers the two sibling events concurrently and in either order.
  // Whichever lands second must be a no-op on the campaign: the same id is
  // re-written (a merged jsonb patch, so no clobbering), and `becamePro` is
  // what gates the one-time upgrade side effects, so a second delivery cannot
  // announce or stamp the upgrade again.
  it('is a no-op on a campaign the created event already fulfilled', async () => {
    const campaign = await seedCampaign()
    const opponentCollection = spyOnOpponentCollection()

    await deliverStripeEvent(
      subscriptionCreatedEvent({
        subscriptionId: 'sub_racing',
        customerId: 'cus_racing',
        status: 'active',
        metadata: { userId: String(service.user.id) },
      }),
    )
    const afterCreated = await readCampaign(campaign.id)
    expect(afterCreated.isPro).toBe(true)

    const res = await deliverStripeEvent(
      checkoutCompletedEvent({
        subscriptionId: 'sub_racing',
        customerId: 'cus_racing',
        userId: service.user.id,
      }),
    )

    expect(res.status).toBe(200)

    const afterCompleted = await readCampaign(campaign.id)
    expect(afterCompleted.details.subscriptionId).toBe('sub_racing')
    expect(afterCompleted.isPro).toBe(true)
    expect(afterCompleted.details.isProUpdatedAt).toBe(
      afterCreated.details.isProUpdatedAt,
    )
    expect(opponentCollection).toHaveBeenCalledExactlyOnceWith(campaign.id)
  })

  // The reverse order: Stripe delivers the two sibling events concurrently, so
  // `completed` can be the arm that fulfils. The `created` event that follows
  // finds the id already stored and the campaign already Pro, and must change
  // nothing — no second flip, no second stamp, no second one-time dispatch.
  it('is a no-op when the created event arrives after the completion', async () => {
    const campaign = await seedCampaign()
    const opponentCollection = spyOnOpponentCollection()

    await deliverStripeEvent(
      checkoutCompletedEvent({
        subscriptionId: 'sub_completed_first',
        customerId: 'cus_completed_first',
        userId: service.user.id,
      }),
    )
    const afterCompleted = await readCampaign(campaign.id)
    expect(afterCompleted.isPro).toBe(true)

    const res = await deliverStripeEvent(
      subscriptionCreatedEvent({
        subscriptionId: 'sub_completed_first',
        customerId: 'cus_completed_first',
        status: 'active',
        metadata: {
          userId: String(service.user.id),
          campaignId: String(campaign.id),
        },
      }),
    )

    expect(res.status).toBe(200)

    const afterCreated = await readCampaign(campaign.id)
    expect(afterCreated.details.subscriptionId).toBe('sub_completed_first')
    expect(afterCreated.isPro).toBe(true)
    expect(afterCreated.details.isProUpdatedAt).toBe(
      afterCompleted.details.isProUpdatedAt,
    )
    expect(opponentCollection).toHaveBeenCalledExactlyOnceWith(campaign.id)
  })
})
