import { addDays, subMinutes } from 'date-fns'
import type Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Campaign,
  OutreachStatus,
  OutreachType,
  P2pSmsSettleState,
  PhoneListBuildStatus,
} from '@/generated/prisma'
import { OutreachService } from '@/outreach/services/outreach.service'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'
import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'

// The p2pSmsCaptureSweep schedule and the per-hold jobs it sends, against a
// real database with Stripe and the Peerly finalize stubbed.
const service = useTestService({ jobs: true })

const LEADS_LOADED = 500
const AUTHORIZED = calcTextAmountInCents(LEADS_LOADED)

const intent = (
  id: string,
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.Response<Stripe.PaymentIntent> =>
  ({
    id,
    object: 'payment_intent',
    status: 'requires_capture',
    amount: AUTHORIZED,
    latest_charge: `ch_${id}`,
    ...overrides,
  }) as unknown as Stripe.Response<Stripe.PaymentIntent>

let campaign: Campaign
let retrieve: ReturnType<typeof vi.spyOn>
let capture: ReturnType<typeof vi.spyOn>
let nextListId = 9100

const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

beforeEach(async () => {
  process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  const stripe = service.app.get(StripeService)
  retrieve = vi
    .spyOn(stripe, 'retrievePaymentIntent')
    .mockImplementation(async (id: string) => intent(id))
  capture = vi
    .spyOn(stripe, 'capturePaymentIntent')
    .mockImplementation(async (id: string, amount: number) =>
      intent(id, { status: 'succeeded', amount_received: amount }),
    )
  const slug = `capture-sweep-${Date.now()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      organizationSlug: slug,
      userId: service.user.id,
      slug: `${slug}-campaign`,
      isPro: true,
    },
  })
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
  else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
})

// A sent Win P2P send whose phone list is ready, and its hold.
const createHold = async ({
  settleState,
  intentId,
  minutesSinceUpdate,
}: {
  settleState: P2pSmsSettleState
  intentId: string
  minutesSinceUpdate: number
}): Promise<number> => {
  const peerlyListId = nextListId++
  const build = await service.prisma.peerlyPhoneList.create({
    data: {
      organizationSlug: campaign.organizationSlug,
      campaignId: campaign.id,
      peerlyListId,
      buildStatus: PhoneListBuildStatus.ready,
      leadsLoaded: LEADS_LOADED,
    },
  })
  const outreach = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: campaign.organizationSlug,
      outreachType: OutreachType.p2p,
      status: OutreachStatus.pending,
      phoneListId: peerlyListId,
      projectId: `job-${peerlyListId}`,
    },
  })
  await service.prisma.outreachP2pSms.create({
    data: {
      outreachId: outreach.id,
      peerlyPhoneListId: build.id,
      settleState,
      authorizationIntentId: intentId,
      authorizedAmountInCents: AUTHORIZED,
      captureBefore: addDays(new Date(), 5),
    },
  })
  // @updatedAt is always overwritten by Prisma, so age it directly.
  await service.prisma.$executeRaw`
    UPDATE outreach_p2p_sms
    SET updated_at = ${subMinutes(new Date(), minutesSinceUpdate)}
    WHERE outreach_id = ${outreach.id}`
  return outreach.id
}

const settleStateOf = async (outreachId: number) =>
  (
    await service.prisma.outreachP2pSms.findUniqueOrThrow({
      where: { outreachId },
    })
  ).settleState

describe('p2pSmsCaptureSweep', () => {
  it('captures each authorized hold past the grace window, once, under its stable key', async () => {
    const first = await createHold({
      settleState: P2pSmsSettleState.authorized,
      intentId: 'pi_first',
      minutesSinceUpdate: 5,
    })
    const second = await createHold({
      settleState: P2pSmsSettleState.authorized,
      intentId: 'pi_second',
      minutesSinceUpdate: 5,
    })

    await service.jobs.runSchedule('p2pSmsCaptureSweep')
    await service.jobs.runSchedule('p2pSmsCaptureSweep')

    expect(capture).toHaveBeenCalledTimes(2)
    expect(capture).toHaveBeenCalledWith(
      'pi_first',
      AUTHORIZED,
      'p2p-sms-capture-pi_first',
    )
    expect(await settleStateOf(first)).toBe(P2pSmsSettleState.captured)
    expect(await settleStateOf(second)).toBe(P2pSmsSettleState.captured)
  })

  it('leaves a hold inside the grace window for the recording webhook', async () => {
    const fresh = await createHold({
      settleState: P2pSmsSettleState.authorized,
      intentId: 'pi_fresh',
      minutesSinceUpdate: 0,
    })

    await service.jobs.runSchedule('p2pSmsCaptureSweep')

    expect(capture).not.toHaveBeenCalled()
    expect(await settleStateOf(fresh)).toBe(P2pSmsSettleState.authorized)
  })

  it('records a stale capturing row whose PI already succeeded without capturing again', async () => {
    retrieve.mockImplementation(async (id: string) =>
      intent(id, { status: 'succeeded', amount_received: 777 }),
    )
    const stale = await createHold({
      settleState: P2pSmsSettleState.capturing,
      intentId: 'pi_stale',
      minutesSinceUpdate: 20,
    })

    await service.jobs.runSchedule('p2pSmsCaptureSweep')

    expect(capture).not.toHaveBeenCalled()
    expect(
      await service.prisma.outreachP2pSms.findUniqueOrThrow({
        where: { outreachId: stale },
      }),
    ).toMatchObject({
      settleState: P2pSmsSettleState.captured,
      capturedAmountInCents: 777,
    })
  })

  it('captures a stale capturing row whose PI is still requires_capture', async () => {
    const stale = await createHold({
      settleState: P2pSmsSettleState.capturing,
      intentId: 'pi_stuck',
      minutesSinceUpdate: 20,
    })

    await service.jobs.runSchedule('p2pSmsCaptureSweep')

    expect(capture).toHaveBeenCalledOnce()
    expect(await settleStateOf(stale)).toBe(P2pSmsSettleState.captured)
  })

  it('re-finalizes a paid pre-build draft stranded past the build-ready edge', async () => {
    const finalize = vi
      .spyOn(service.app.get(OutreachService), 'finalizeOutreachPurchase')
      .mockResolvedValue(undefined as never)
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
      intentId: 'pi_prebuild',
      minutesSinceUpdate: 5,
    })
    const { phoneListId } = await service.prisma.outreach.update({
      where: { id: outreachId },
      data: {
        status: OutreachStatus.pending_payment,
        phoneListId: null,
        projectId: null,
        stripeCheckoutSessionId: 'cs_paid',
      },
    })
    expect(phoneListId).toBeNull()

    await service.jobs.runSchedule('p2pSmsCaptureSweep')

    expect(finalize).toHaveBeenCalledWith(outreachId, campaign.id, 'cs_paid')
    const outreach = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(outreach.phoneListId).not.toBeNull()
    // Never charged for a send that has not gone out: no projectId yet.
    expect(capture).not.toHaveBeenCalled()
    expect(await settleStateOf(outreachId)).toBe(P2pSmsSettleState.authorized)
  })

  it('does nothing off the dev and prod deploys', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'preview'
    const hold = await createHold({
      settleState: P2pSmsSettleState.authorized,
      intentId: 'pi_preview',
      minutesSinceUpdate: 5,
    })

    await service.jobs.runSchedule('p2pSmsCaptureSweep')

    expect(retrieve).not.toHaveBeenCalled()
    expect(await settleStateOf(hold)).toBe(P2pSmsSettleState.authorized)
  })
})
