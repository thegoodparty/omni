import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { useTestService } from '@/test-service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { addDays, format } from 'date-fns'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebhookEventType } from './payments.types'

// Route-level coverage for the *consequences* of a Pro cancellation, driven
// through the real `POST /v1/payments/events` controller against a real
// Postgres. A cancellation that reaches Stripe has to produce three local
// effects, and in the 30 days to 2026-09-17 production produced none of them:
// the campaign stops being Pro, `details` stops pointing at a subscription,
// and the team is told. Zero `PRO PLAN CANCELLATION` Slack messages were sent
// in that window because the notification is the last statement in the
// handler, so anything that threw earlier took it down with the de-Pro.
//
// Why here and not in Playwright: the Slack notification — the effect whose
// absence went unnoticed for a month — is not observable from a browser at
// all, and the webhook leg cannot be delivered to a per-PR preview
// (e2e-tests/AGENTS.md § @dev-only). In-process, both problems disappear: the
// signature can be generated with the same secret the app verifies against, so
// a correctly-shaped event goes through parse -> dispatch -> handler -> DB for
// real, and `SlackService.message` is a spy. No new production surface, and it
// runs on every PR instead of only post-merge.
//
// Unit coverage for the *unmatched* subscription conditions (no campaign
// carries the id) lives in `services/paymentEventsService.test.ts`, where
// `campaignsService` is mocked. This suite deliberately only covers the
// resolved arm, which mocks cannot speak to: that `findBySubscriptionId`'s
// JSONB path actually matches an id written by `patchCampaignDetails`, and that
// `persistCampaignProCancellation` actually lands on the row.

const service = useTestService()

const WEBHOOK_ROUTE = '/v1/payments/events'

// The real Stripe ids from the two production cancellations this suite exists
// for, so the fixtures read as those incidents rather than as invented shapes.
// Both subscriptions are canceled at Stripe and neither belongs to a test
// account, so nothing here can act on a live subscription.
const CANCELLATION_REQUESTED_SUB = 'sub_1TnLmw1taBPnTqn4vQERKKXD'
const CANCELLATION_REQUESTED_CUSTOMER = 'cus_Umvew4wWrtcSi5'
const DUNNING_EXHAUSTED_SUB = 'sub_1TlI0T1taBPnTqn4wXcOjDJQ'
const DUNNING_EXHAUSTED_CUSTOMER = 'cus_Ukna4d5HsEPEVJ'

// Signing-only client. Constructing a Stripe instance makes no network call,
// and this one is never used to talk to Stripe — `generateTestHeaderString` is
// a local HMAC over the payload, the same computation Stripe performs before
// delivery and `StripeService.parseWebhookEvent` verifies on arrival.
const signer = new Stripe('sk_test_signing_only')

// Post the exact bytes that were signed: the controller reads `rawBody`, so
// re-serializing between signing and sending would fail verification and the
// test would be asserting against a 400 rather than the handler.
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

type SubscriptionEventOptions = {
  type: string
  subscriptionId: string
  customerId: string
  status: Stripe.Subscription.Status
  cancellationReason?: Stripe.Subscription.CancellationDetails.Reason
  canceledAt?: number | null
  cancelAt?: number | null
  previousAttributes?: Record<string, unknown>
}

let eventSeq = 0

// A `customer.subscription.*` envelope carrying the fields the handlers read.
// Shaped like a real delivery (not a hand-rolled minimum) so a handler that
// starts reading another field of the subscription keeps working here.
const subscriptionEvent = ({
  type,
  subscriptionId,
  customerId,
  status,
  cancellationReason,
  canceledAt = null,
  cancelAt = null,
  previousAttributes,
}: SubscriptionEventOptions): Record<string, unknown> => {
  eventSeq += 1
  return {
    id: `evt_test_pro_cancellation_${eventSeq}`,
    object: 'event',
    api_version: '2025-03-31.basil',
    created: nowInSeconds(),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
    data: {
      object: {
        id: subscriptionId,
        object: 'subscription',
        customer: customerId,
        currency: 'usd',
        status,
        canceled_at: canceledAt,
        cancel_at: cancelAt,
        cancel_at_period_end: Boolean(cancelAt),
        cancellation_details: cancellationReason
          ? { comment: null, feedback: null, reason: cancellationReason }
          : null,
        items: { object: 'list', data: [], has_more: false, url: '' },
      },
      ...(previousAttributes
        ? { previous_attributes: previousAttributes }
        : {}),
    },
  }
}

let campaignSeq = 0

// A Pro campaign in the state a completed Pro checkout leaves behind:
// `isPro` set and `details.subscriptionId` pointing at the live subscription,
// which is the only mapping from a subscription back to an account.
const seedProCampaign = async (subscriptionId: string) => {
  campaignSeq += 1
  const slug = `pro-cancellation-${campaignSeq}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      slug,
      organizationSlug: slug,
      userId: service.user.id,
      isPro: true,
      details: {
        electionDate: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
        subscriptionId,
      },
    },
  })
}

const readCampaign = (id: number) =>
  service.prisma.campaign.findUniqueOrThrow({ where: { id } })

const spyOnSlack = () =>
  vi
    .spyOn(service.app.get(SlackService), 'message')
    .mockResolvedValue(undefined)

// `persistCampaignProCancellation` ends in a CRM sync, and the harness carries
// a HubSpot token, so the real call goes out, 401s, and reports itself to Slack
// — two extra `SlackService.message` calls that would both make the suite
// network-dependent and blunt the assertion that the cancellation notice is
// sent exactly once. The sync is incidental to the cancellation consequences
// under test, so stub it (same reason as follow-on.controller.test.ts).
beforeEach(() => {
  vi.spyOn(
    service.app.get(CrmCampaignsService),
    'trackCampaign',
  ).mockResolvedValue(undefined)
})

describe('POST /v1/payments/events — customer.subscription.deleted', () => {
  // The headline production case: sub_1TnLmw1taBPnTqn4vQERKKXD, cancelled
  // 2026-09-08 with `cancellation_details.reason = cancellation_requested`.
  // The campaign was never un-Pro'd and nobody was told. All three
  // consequences are asserted in one test on purpose — they are one outcome,
  // and the month-long outage was precisely that an earlier one failing
  // silently cancelled the later ones.
  it('un-Pros the campaign, clears the subscription pointer and reports the cancellation', async () => {
    const campaign = await seedProCampaign(CANCELLATION_REQUESTED_SUB)
    const slackMessage = spyOnSlack()
    const canceledAt = nowInSeconds()

    const res = await deliverStripeEvent(
      subscriptionEvent({
        type: WebhookEventType.CustomerSubscriptionDeleted,
        subscriptionId: CANCELLATION_REQUESTED_SUB,
        customerId: CANCELLATION_REQUESTED_CUSTOMER,
        status: 'canceled',
        cancellationReason: 'cancellation_requested',
        canceledAt,
      }),
    )

    expect(res.status).toBe(200)

    const updated = await readCampaign(campaign.id)
    expect(updated.isPro).toBe(false)
    // Nothing is left billing this campaign as far as the product is
    // concerned: the pointer a renewal webhook would resolve through is gone,
    // and the cancellation is stamped.
    expect(updated.details.subscriptionId).toBeNull()
    expect(updated.details.subscriptionCanceledAt).toEqual(expect.any(Number))

    // The notification the team never received. Asserted on content, not just
    // on the call, because `PRO PLAN CANCELLATION` is the string the team
    // greps and the alerting counts.
    expect(slackMessage).toHaveBeenCalledTimes(1)
    const [message] = slackMessage.mock.calls[0]!
    expect(message.text).toContain('PRO PLAN CANCELLATION')
    expect(message.text).toContain(service.user.email)
    expect(message.text).toContain(campaign.slug)
  })

  // Dunning exhaustion: sub_1TlI0T1taBPnTqn4wXcOjDJQ, cancelled 2026-09-06
  // with reason `payment_failed`. Production left that campaign Pro after the
  // payments stopped. The handler is reason-agnostic today and this test's job
  // is to keep it that way — a de-Pro conditioned on the customer having
  // *asked* would hand free Pro to everyone whose card simply failed.
  it('un-Pros a campaign whose subscription was cancelled by dunning exhaustion', async () => {
    const campaign = await seedProCampaign(DUNNING_EXHAUSTED_SUB)
    const slackMessage = spyOnSlack()

    const res = await deliverStripeEvent(
      subscriptionEvent({
        type: WebhookEventType.CustomerSubscriptionDeleted,
        subscriptionId: DUNNING_EXHAUSTED_SUB,
        customerId: DUNNING_EXHAUSTED_CUSTOMER,
        status: 'canceled',
        cancellationReason: 'payment_failed',
        canceledAt: nowInSeconds(),
      }),
    )

    expect(res.status).toBe(200)

    const updated = await readCampaign(campaign.id)
    expect(updated.isPro).toBe(false)
    expect(updated.details.subscriptionId).toBeNull()
    expect(slackMessage).toHaveBeenCalledTimes(1)
    expect(slackMessage.mock.calls[0]![0].text).toContain(
      'PRO PLAN CANCELLATION',
    )
  })

  // `setIsPro` stamps `details.isProUpdatedAt` only on a genuine non-Pro ->
  // Pro transition, because that stamp is what the CRM sync publishes as
  // HubSpot's `pro_upgrade_date`. A cancellation must not overwrite the real
  // upgrade date with the cancellation date, which is what "the `details` keys
  // left in a coherent state" means for this key.
  it('leaves the recorded Pro upgrade date alone when de-Pro-ing', async () => {
    const upgradedAt = '2026-01-15T00:00:00Z'
    campaignSeq += 1
    const slug = `pro-cancellation-stamp-${campaignSeq}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        slug,
        organizationSlug: slug,
        userId: service.user.id,
        isPro: true,
        details: {
          electionDate: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
          subscriptionId: CANCELLATION_REQUESTED_SUB,
          isProUpdatedAt: upgradedAt,
        },
      },
    })
    spyOnSlack()

    const res = await deliverStripeEvent(
      subscriptionEvent({
        type: WebhookEventType.CustomerSubscriptionDeleted,
        subscriptionId: CANCELLATION_REQUESTED_SUB,
        customerId: CANCELLATION_REQUESTED_CUSTOMER,
        status: 'canceled',
        cancellationReason: 'cancellation_requested',
        canceledAt: nowInSeconds(),
      }),
    )

    expect(res.status).toBe(200)
    const updated = await readCampaign(campaign.id)
    expect(updated.isPro).toBe(false)
    expect(updated.details.isProUpdatedAt).toBe(upgradedAt)
  })

  // A deleted account's subscription is cancelled as part of the deletion, so
  // the resulting event has nothing left to un-Pro and nobody to notify. The
  // guard is `metaData.isDeleted`; without it the handler reports a
  // cancellation for an account that asked to be gone.
  it('does not report a cancellation for an account that is already deleted', async () => {
    const campaign = await seedProCampaign(CANCELLATION_REQUESTED_SUB)
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { metaData: { isDeleted: true } },
    })
    const slackMessage = spyOnSlack()

    const res = await deliverStripeEvent(
      subscriptionEvent({
        type: WebhookEventType.CustomerSubscriptionDeleted,
        subscriptionId: CANCELLATION_REQUESTED_SUB,
        customerId: CANCELLATION_REQUESTED_CUSTOMER,
        status: 'canceled',
        cancellationReason: 'cancellation_requested',
        canceledAt: nowInSeconds(),
      }),
    )

    expect(res.status).toBe(200)
    expect(slackMessage).not.toHaveBeenCalled()
    // Left untouched rather than half-processed: the deletion owns the
    // teardown. Both keys are asserted because `persistCampaignProCancellation`
    // only writes them together today — were they ever separated, checking one
    // would let an unguarded flip of the other through unnoticed.
    const updated = await readCampaign(campaign.id)
    expect(updated.isPro).toBe(true)
    expect(updated.details.subscriptionId).toBe(CANCELLATION_REQUESTED_SUB)
  })
})

describe('POST /v1/payments/events — customer.subscription.updated', () => {
  // Cancelling through the billing portal schedules the cancellation for the
  // end of the paid period; Stripe reports it as an `updated` event carrying
  // `cancel_at`, and the `deleted` event only arrives when the period ends.
  // The campaign must stay Pro until then — they have paid for it — and the
  // scheduled date has to be recorded, because it is the only thing that tells
  // a de-Pro that is due from one that has gone missing.
  it('records a scheduled cancellation without un-Pro-ing the campaign yet', async () => {
    const campaign = await seedProCampaign(CANCELLATION_REQUESTED_SUB)
    const slackMessage = spyOnSlack()
    const cancelAt = nowInSeconds() + 60 * 60 * 24 * 20

    const res = await deliverStripeEvent(
      subscriptionEvent({
        type: WebhookEventType.CustomerSubscriptionUpdated,
        subscriptionId: CANCELLATION_REQUESTED_SUB,
        customerId: CANCELLATION_REQUESTED_CUSTOMER,
        status: 'active',
        cancellationReason: 'cancellation_requested',
        cancelAt,
        previousAttributes: { cancel_at: null },
      }),
    )

    expect(res.status).toBe(200)

    const updated = await readCampaign(campaign.id)
    expect(updated.details.subscriptionCancelAt).toBe(cancelAt)
    expect(updated.isPro).toBe(true)
    expect(updated.details.subscriptionId).toBe(CANCELLATION_REQUESTED_SUB)
    // Nothing has been cancelled yet, so the team is not told yet — the
    // `PRO PLAN CANCELLATION` message belongs to the `deleted` event.
    expect(slackMessage).not.toHaveBeenCalled()
  })
})
