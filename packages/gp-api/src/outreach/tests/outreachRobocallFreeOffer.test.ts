import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import type { ClerkClient } from '@clerk/backend'
import { addDays, getUnixTime } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { useTestService } from '@/test-service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { FeaturesService } from '@/features/services/features.service'
import { OutreachNotificationService } from '@/outreach/services/outreachNotification.service'
import { OutreachRobocallService } from '@/outreach/services/outreachRobocall.service'
import { VoterRecommendedListsService } from '@/peopleDb/services/voterRecommendedLists.service'
import type { DbxDistrict } from '@/peopleDb/databricks/databricksVoterSql.util'
import { RobocallFreeOfferService } from '@/robocallFreeOffer/services/robocallFreeOffer.service'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import {
  Campaign,
  OutreachStatus,
  RobocallSettleState,
} from '../../generated/prisma'

// The free election-eve robocall offer through the API: who gets it, the
// per-campaign code, and the binding that stops the code paying for any
// other robocall. The warehouse and election reads are stubbed; everything
// else (eligibility, enrollment, the list check, apply and authorize) is real.

const service = useTestService()

const EXPERIMENT = 'robocall-free-offer-2026-11'
const VARIANT = 'freeOfferElectionEveRobocall'
const FLAG = 'robocall-free-offer'
const CAMPAIGN_ID = 996

const district: DbxDistrict = {
  districtId: 'district-1',
  dataset: 'voters',
  table: 'goodparty_data_catalog.mart_gp_api.gp_api_voters',
  state: 'TX',
  districtType: 'City',
  districtName: 'GEORGETOWN',
  useVoterOnlyPath: false,
}
const PRECINCTS = ['P1', 'P2', 'P3', 'P4'].map((precinct) => ({
  county: 'WILLIAMSON',
  precinct,
  landlines: 100,
}))
// The treatment half the binding tests pin, so the offer list is known.
const TREATMENT = ['WILLIAMSON|P1', 'WILLIAMSON|P3']

const promotionCodesList = vi.fn()
const promotionCodesCreate = vi.fn()
const promotionCodesUpdate = vi.fn()
const clerkGetUser = vi.fn()

let campaign: Campaign
let orgSlug: string
let offerListId: number

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

// A promotion code as Stripe lists it, with the coupon expanded.
const offerPromo = (
  overrides: {
    id?: string
    code?: string
    campaignId?: string
    coupon?: Partial<Stripe.Coupon>
  } = {},
) =>
  ({
    id: overrides.id ?? 'promo_offer',
    code: overrides.code ?? 'GPOFFER-TESTCODE',
    active: true,
    livemode: false,
    metadata: {
      experiment: EXPERIMENT,
      campaignId: overrides.campaignId ?? String(CAMPAIGN_ID),
    },
    restrictions: { minimum_amount: null },
    promotion: {
      type: 'coupon',
      coupon: {
        id: 'robocall-free-offer-2026-11',
        amount_off: 40000,
        percent_off: null,
        currency: 'usd',
        valid: true,
        ...overrides.coupon,
      },
    },
  }) as unknown as Stripe.PromotionCode

// The owner as Clerk has them: staff is decided by the Clerk primary email.
const clerkUser = (emailAddress: string, status = 'verified') =>
  ({
    primaryEmailAddress: { emailAddress, verification: { status } },
  }) as unknown as Awaited<ReturnType<ClerkClient['users']['getUser']>>

const listResult = (promo: Stripe.PromotionCode | null) =>
  ({
    data: promo ? [promo] : [],
  }) as unknown as Stripe.ApiList<Stripe.PromotionCode>

// The offer ends after Election Day (Nov 3, Eastern) on the real clock, so
// the clock is pinned before it. Only Date is faked: HTTP and Prisma keep
// real timers.
const BEFORE_ELECTION = new Date('2026-10-30T16:00:00Z')
const AFTER_ELECTION = new Date('2026-11-04T06:00:00Z')

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(BEFORE_ELECTION)

  const stripeClient = (
    service.app.get(StripeService) as unknown as { stripe: Stripe }
  ).stripe
  vi.spyOn(stripeClient.promotionCodes, 'list').mockImplementation(
    promotionCodesList,
  )
  vi.spyOn(stripeClient.promotionCodes, 'create').mockImplementation(
    promotionCodesCreate,
  )
  vi.spyOn(stripeClient.promotionCodes, 'update').mockImplementation(
    promotionCodesUpdate,
  )
  promotionCodesUpdate.mockResolvedValue({})
  promotionCodesList.mockResolvedValue(listResult(offerPromo()))
  promotionCodesCreate.mockImplementation(async (params) =>
    offerPromo({ code: params.code }),
  )
  const clerk = service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN)
  vi.spyOn(clerk.users, 'getUser').mockImplementation(clerkGetUser)
  clerkGetUser.mockResolvedValue(clerkUser('tests@goodparty.org'))

  const offer = service.app.get(RobocallFreeOfferService)
  // The coupon id is read from the environment when the service is built.
  Object.assign(offer, { couponId: 'robocall-free-offer-2026-11' })

  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockResolvedValue(true)
  vi.spyOn(
    service.app.get(ElectionsService),
    'getPositionById',
  ).mockResolvedValue({ isWinIcp: true } as never)
  const contacts = service.app.get(ContactsService)
  vi.spyOn(contacts, 'resolveEligibleDistrict').mockResolvedValue({
    districtId: district.districtId,
    dataset: 'voters',
  })
  vi.spyOn(contacts, 'resolveSavedFilterForQuery').mockResolvedValue({
    filters: {},
    empty: false,
  })
  vi.spyOn(contacts, 'affinityColumnFor').mockResolvedValue(undefined)
  const reads = service.app.get(VoterRecommendedListsService)
  vi.spyOn(reads, 'resolveDistrict').mockResolvedValue(district)
  vi.spyOn(reads, 'precinctLandlines').mockResolvedValue({
    precincts: PRECINCTS,
    truncated: false,
  })
  vi.spyOn(reads, 'countForFilter').mockResolvedValue(180)

  vi.spyOn(
    service.app.get(OutreachRobocallService),
    'deriveBillableCount',
  ).mockResolvedValue(180)
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockResolvedValue(
    undefined as never,
  )
  vi.spyOn(
    service.app.get(OutreachNotificationService),
    'notifyRobocallScheduled',
  ).mockResolvedValue(undefined)

  const campaignId = CAMPAIGN_ID
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-icp' },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'offer-candidate',
      isPro: true,
      details: { state: 'TX', electionDate: '2026-11-03' },
      data: {},
      aiContent: {},
    },
  })
  // Already texting: one text past checkout.
  await service.prisma.outreach.create({
    data: {
      campaignId,
      organizationSlug: orgSlug,
      outreachType: 'text',
      status: OutreachStatus.completed,
    },
  })
  offerListId = (
    await service.prisma.voterFileFilter.create({
      data: {
        organizationSlug: orgSlug,
        name: 'Promotional robocall: landline voters in selected precincts',
        hasLandline: true,
        votedStatus: ['unknown'],
        precincts: TREATMENT,
        recommendedVariant: VARIANT,
        recommendedModified: false,
        firstUsedForOutreachAt: new Date(),
      },
    })
  ).id
})

// Enrolls the campaign with a known treatment half, as a first resolution
// would have.
const enroll = async (arm = 'offered') => {
  await service.prisma.campaignExperimentAssignment.create({
    data: {
      campaignId: campaign.id,
      flagKey: FLAG,
      arm,
      ownerUserId: service.user.id,
    },
  })
  await service.prisma.robocallExperimentPrecinct.createMany({
    data: PRECINCTS.map(({ county, precinct, landlines }) => ({
      experimentKey: EXPERIMENT,
      state: district.state,
      county,
      precinct,
      arm: TREATMENT.includes(`${county}|${precinct}`)
        ? 'treatment'
        : 'control',
      pTreatment: 0.5,
      assignedForDistrictId: district.districtId,
      assignedForCampaignId: campaign.id,
      landlinesAtAssignment: landlines,
    })),
  })
}

const createDraft = async (listId: number): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: OutreachStatus.pending_payment,
      date: addDays(new Date(), 2),
      voterFileFilterId: listId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/${campaign.id}/${randomUUID()}.webm`,
      callbackNumber: '+15125550123',
      billableCount: 180,
      amountInCents: 1010,
      settleState: RobocallSettleState.pending_payment,
    },
  })
  return spine.id
}

const applyPromo = (outreachId: number, code = 'GPOFFER-TESTCODE') =>
  service.client.post(
    `/v1/outreach/robocall/${outreachId}/promo`,
    { code },
    orgHeaders(),
  )

const authorize = (outreachId: number) =>
  service.client.post(
    `/v1/outreach/robocall/${outreachId}/authorize`,
    {},
    orgHeaders(),
  )

// The test user's email is tests@goodparty.org, and a goodparty.org owner
// skips most eligibility rules, so the tests of those rules move the owner
// outside it first.
const asCandidate = () =>
  service.prisma.user.update({
    where: { id: service.user.id },
    data: { email: 'candidate@example.com' },
  })

const bookRobocall = (promoCode?: string) =>
  service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: OutreachStatus.pending,
      ...(promoCode
        ? {
            robocall: {
              create: {
                audioKey: `robocall/${campaign.id}/${randomUUID()}.webm`,
                callbackNumber: '+15125550123',
                billableCount: 180,
                amountInCents: 0,
                settleState: RobocallSettleState.pending_payment,
                promoCode,
              },
            },
          }
        : {}),
    },
  })

describe('GET /v1/campaigns/mine/robocall-offer', () => {
  it('enrolls an eligible campaign and returns the offer list size', async () => {
    const result = await service.client.get(
      '/v1/campaigns/mine/robocall-offer',
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data).toEqual({
      eligible: true,
      variant: VARIANT,
      count: 180,
      coveredCalls: 8844,
    })
    const enrollment =
      await service.prisma.campaignExperimentAssignment.findFirstOrThrow({
        where: { campaignId: campaign.id, flagKey: FLAG },
      })
    expect(enrollment.arm).toBe('offered')
    const arms = await service.prisma.robocallExperimentPrecinct.findMany({
      where: { experimentKey: EXPERIMENT },
    })
    expect(arms).toHaveLength(4)
    expect(arms.filter((row) => row.arm === 'treatment')).toHaveLength(2)
    expect(arms.every((row) => row.pTreatment === 0.5)).toBe(true)
  })

  it('does not offer to a campaign that already booked a robocall', async () => {
    await asCandidate()
    await bookRobocall()

    const result = await service.client.get(
      '/v1/campaigns/mine/robocall-offer',
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data.eligible).toBe(false)
  })

  it('does not offer to a withdrawn campaign', async () => {
    await enroll('withdrawn')

    const result = await service.client.get(
      '/v1/campaigns/mine/robocall-offer',
      orgHeaders(),
    )

    expect(result.data.eligible).toBe(false)
  })

  it('offers to a goodparty.org owner whatever the eligibility rules say', async () => {
    await service.prisma.outreach.deleteMany({
      where: { campaignId: campaign.id },
    })
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        isPro: false,
        isDemo: true,
        details: { state: 'TX', electionDate: '2026-12-08' },
      },
    })
    vi.mocked(
      service.app.get(FeaturesService).isFeatureEnabled,
    ).mockResolvedValue(false)
    vi.mocked(
      service.app.get(ElectionsService).getPositionById,
    ).mockResolvedValue({ isWinIcp: false } as never)

    const result = await service.client.get(
      '/v1/campaigns/mine/robocall-offer',
      orgHeaders(),
    )

    expect(result.data.eligible).toBe(true)
  })

  it('does not take a goodparty.org email Clerk has not verified as staff', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { isPro: false },
    })
    clerkGetUser.mockResolvedValue(
      clerkUser('tests@goodparty.org', 'unverified'),
    )

    const result = await service.client.get(
      '/v1/campaigns/mine/robocall-offer',
      orgHeaders(),
    )

    expect(result.data.eligible).toBe(false)
  })

  it('does not take a goodparty.org email set only in gp-api as staff', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { isPro: false },
    })
    clerkGetUser.mockResolvedValue(clerkUser('candidate@example.com'))

    const result = await service.client.get(
      '/v1/campaigns/mine/robocall-offer',
      orgHeaders(),
    )

    expect(result.data.eligible).toBe(false)
  })

  it('offers to a goodparty.org owner who booked another robocall', async () => {
    await bookRobocall()

    const result = await service.client.get(
      '/v1/campaigns/mine/robocall-offer',
      orgHeaders(),
    )

    expect(result.data.eligible).toBe(true)
  })

  it('does not offer to a goodparty.org owner who booked the offer run', async () => {
    await bookRobocall('GPOFFER-TESTCODE')

    const result = await service.client.get(
      '/v1/campaigns/mine/robocall-offer',
      orgHeaders(),
    )

    expect(result.data.eligible).toBe(false)
  })

  describe('for an owner outside goodparty.org', () => {
    beforeEach(async () => {
      await asCandidate()
    })

    it('offers to a campaign that meets every rule', async () => {
      const result = await service.client.get(
        '/v1/campaigns/mine/robocall-offer',
        orgHeaders(),
      )

      expect(result.data.eligible).toBe(true)
    })

    it('does not offer to a campaign that is not Pro', async () => {
      await service.prisma.campaign.update({
        where: { id: campaign.id },
        data: { isPro: false },
      })

      const result = await service.client.get(
        '/v1/campaigns/mine/robocall-offer',
        orgHeaders(),
      )

      expect(result.data.eligible).toBe(false)
    })

    it('does not offer to a campaign that has sent no texts', async () => {
      await service.prisma.outreach.deleteMany({
        where: { campaignId: campaign.id },
      })

      const result = await service.client.get(
        '/v1/campaigns/mine/robocall-offer',
        orgHeaders(),
      )

      expect(result.data.eligible).toBe(false)
    })

    it('does not offer while the flag is off', async () => {
      vi.mocked(
        service.app.get(FeaturesService).isFeatureEnabled,
      ).mockResolvedValue(false)

      const result = await service.client.get(
        '/v1/campaigns/mine/robocall-offer',
        orgHeaders(),
      )

      expect(result.data.eligible).toBe(false)
    })
  })
})

describe('the offer code', () => {
  it('is one code per campaign, expiring after Election Day', async () => {
    await enroll()
    const offer = service.app.get(RobocallFreeOfferService)
    const organization = await service.prisma.organization.findUniqueOrThrow({
      where: { slug: orgSlug },
    })
    promotionCodesList.mockResolvedValue(listResult(null))

    const first = await createDraft(offerListId)
    const code = await offer.codeForDraft({
      organization,
      campaign,
      outreachId: first,
      voterFileFilterId: offerListId,
    })

    expect(code).toMatch(/^GPOFFER-[A-Z2-9]{8}$/)
    expect(promotionCodesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        code,
        promotion: { type: 'coupon', coupon: 'robocall-free-offer-2026-11' },
        max_redemptions: 1,
        expires_at: getUnixTime(new Date('2026-11-04T00:00:00Z')),
        metadata: { experiment: EXPERIMENT, campaignId: String(campaign.id) },
      }),
    )

    // Stripe now lists the code as live, so the next draft gets it back.
    promotionCodesList.mockResolvedValue(
      listResult(offerPromo({ code: code! })),
    )
    promotionCodesCreate.mockClear()
    const second = await createDraft(offerListId)

    expect(
      await offer.codeForDraft({
        organization,
        campaign,
        outreachId: second,
        voterFileFilterId: offerListId,
      }),
    ).toBe(code)
    expect(promotionCodesCreate).not.toHaveBeenCalled()
  })

  it('is shared by two drafts opened at once and pays for only one run', async () => {
    await enroll()
    const offer = service.app.get(RobocallFreeOfferService)
    const organization = await service.prisma.organization.findUniqueOrThrow({
      where: { slug: orgSlug },
    })
    // Stripe's promotion codes as one store: unique by code, `active`
    // filterable, flipped by update.
    const codes = new Map<string, Stripe.PromotionCode>()
    const find = (params: { code: string; active?: boolean }) => {
      const promo = codes.get(params.code)
      return listResult(
        promo && (params.active === undefined || promo.active === params.active)
          ? promo
          : null,
      )
    }
    // Both drafts look the code up before either creates it.
    let lookups = 0
    const { promise: bothLookedUp, resolve: releaseLookups } =
      Promise.withResolvers<void>()
    promotionCodesList.mockImplementation(async (params) => {
      lookups += 1
      if (lookups === 2) releaseLookups()
      if (lookups <= 2) await bothLookedUp
      return find(params)
    })
    promotionCodesCreate.mockImplementation(async (params) => {
      if (codes.has(params.code)) {
        throw new Error(`A promotion code ${params.code} already exists`)
      }
      const promo = offerPromo({ id: 'promo_offer', code: params.code })
      codes.set(params.code, promo)
      return promo
    })
    promotionCodesUpdate.mockImplementation(async (id, params) => {
      for (const promo of codes.values()) {
        if (promo.id === id) Object.assign(promo, { active: params.active })
      }
      return {}
    })

    const first = await createDraft(offerListId)
    const second = await createDraft(offerListId)
    const draftCode = (outreachId: number) =>
      offer.codeForDraft({
        organization,
        campaign,
        outreachId,
        voterFileFilterId: offerListId,
      })
    const [firstCode, secondCode] = await Promise.all([
      draftCode(first),
      draftCode(second),
    ])

    expect(firstCode).toMatch(/^GPOFFER-/)
    expect(secondCode).toBe(firstCode)
    expect(promotionCodesCreate).toHaveBeenCalledTimes(2)
    expect(codes.size).toBe(1)

    expect((await applyPromo(first, firstCode!)).status).toBe(
      HttpStatus.CREATED,
    )
    expect((await applyPromo(second, secondCode!)).status).toBe(
      HttpStatus.CREATED,
    )
    const results = await Promise.all([authorize(first), authorize(second)])

    expect(results.map((result) => result.status).sort()).toEqual([
      HttpStatus.CREATED,
      HttpStatus.BAD_REQUEST,
    ])
    const redeemed = await service.prisma.outreachRobocall.findMany({
      where: { promoRedeemedAt: { not: null } },
    })
    expect(redeemed).toHaveLength(1)

    // Canceling the run before it dials hands the code back, and the same
    // code pays for a fresh draft.
    const cancel = await service.client.post(
      `/v1/outreach/${redeemed[0]!.outreachId}/cancel`,
      {},
      orgHeaders(),
    )
    expect(cancel.status).toBe(HttpStatus.CREATED)
    promotionCodesCreate.mockClear()
    const third = await createDraft(offerListId)
    const restored = await draftCode(third)

    expect(restored).toBe(firstCode)
    expect(promotionCodesCreate).not.toHaveBeenCalled()
    expect((await applyPromo(third, restored!)).status).toBe(HttpStatus.CREATED)
    const rebooked = await authorize(third)
    expect(rebooked.status).toBe(HttpStatus.CREATED)
    expect(rebooked.data).toMatchObject({
      status: 'authorized',
      authorizedAmountInCents: 0,
    })
  })

  it('applies to the offer list and schedules the run at $0 with no card', async () => {
    await enroll()
    const draft = await createDraft(offerListId)

    const applied = await applyPromo(draft)
    expect(applied.status).toBe(HttpStatus.CREATED)
    expect(applied.data).toMatchObject({
      coversTotal: true,
      amountDueInCents: 0,
    })

    const result = await authorize(draft)
    expect(result.status).toBe(HttpStatus.CREATED)
    expect(result.data).toMatchObject({
      status: 'authorized',
      authorizedAmountInCents: 0,
    })
    const satellite = await service.prisma.outreachRobocall.findUniqueOrThrow({
      where: { outreachId: draft },
    })
    expect(satellite.promoRedeemedAt).not.toBeNull()
    expect(satellite.promoCoversTotal).toBe(true)
    expect(promotionCodesUpdate).toHaveBeenCalledWith('promo_offer', {
      active: false,
    })
  })

  it('is refused after Election Day', async () => {
    await enroll()
    const draft = await createDraft(offerListId)
    vi.setSystemTime(AFTER_ELECTION)

    const result = await applyPromo(draft)

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('is refused at authorize when Election Day passed after apply', async () => {
    await enroll()
    const draft = await createDraft(offerListId)
    expect((await applyPromo(draft)).status).toBe(HttpStatus.CREATED)
    vi.setSystemTime(AFTER_ELECTION)
    // Still a future send date, so only the offer's end can refuse it.
    await service.prisma.outreach.update({
      where: { id: draft },
      data: { date: addDays(new Date(), 2) },
    })

    const result = await authorize(draft)

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    const satellite = await service.prisma.outreachRobocall.findUniqueOrThrow({
      where: { outreachId: draft },
    })
    expect(satellite.promoRedeemedAt).toBeNull()
  })

  it('is refused when it names another campaign', async () => {
    await enroll()
    promotionCodesList.mockResolvedValue(
      listResult(offerPromo({ campaignId: '12345' })),
    )
    const draft = await createDraft(offerListId)

    const result = await applyPromo(draft)

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it.each([
    ['worth a different amount', { amount_off: 50_000 }],
    ['in another currency', { currency: 'cad' }],
    ['a percent off', { amount_off: null, percent_off: 100 }],
  ])('is refused when its coupon is %s', async (_, coupon) => {
    await enroll()
    promotionCodesList.mockResolvedValue(listResult(offerPromo({ coupon })))
    const draft = await createDraft(offerListId)

    const result = await applyPromo(draft)

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('is refused on a list that is not the offer list', async () => {
    await enroll()
    const other = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: orgSlug, name: 'Everyone', hasLandline: true },
    })
    const draft = await createDraft(other.id)

    const result = await applyPromo(draft)

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('is refused on a modified copy of the offer list', async () => {
    await enroll()
    const modified = await service.prisma.voterFileFilter.create({
      data: {
        organizationSlug: orgSlug,
        name: 'Edited offer list',
        hasLandline: true,
        votedStatus: ['unknown'],
        precincts: ['WILLIAMSON|P1', 'WILLIAMSON|P2', 'WILLIAMSON|P3'],
        recommendedVariant: VARIANT,
        recommendedModified: true,
      },
    })
    const draft = await createDraft(modified.id)

    const result = await applyPromo(draft)

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('is refused once the campaign has booked another robocall', async () => {
    await asCandidate()
    await enroll()
    await bookRobocall()
    const draft = await createDraft(offerListId)

    const result = await applyPromo(draft)

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('is refused for a withdrawn campaign', async () => {
    await enroll('withdrawn')
    const draft = await createDraft(offerListId)

    const result = await applyPromo(draft)

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('is refused at authorize when another robocall was booked after apply', async () => {
    await asCandidate()
    await enroll()
    const draft = await createDraft(offerListId)
    expect((await applyPromo(draft)).status).toBe(HttpStatus.CREATED)
    await bookRobocall()

    const result = await authorize(draft)

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    const satellite = await service.prisma.outreachRobocall.findUniqueOrThrow({
      where: { outreachId: draft },
    })
    expect(satellite.promoRedeemedAt).toBeNull()
  })
})
