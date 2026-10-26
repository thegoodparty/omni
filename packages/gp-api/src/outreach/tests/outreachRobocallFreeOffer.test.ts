import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { addDays } from 'date-fns'
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

let campaign: Campaign
let orgSlug: string
let offerListId: number

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

// A promotion code as Stripe lists it, with the coupon expanded.
const offerPromo = (
  overrides: { id?: string; code?: string; campaignId?: string } = {},
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
      },
    },
  }) as unknown as Stripe.PromotionCode

const listResult = (promo: Stripe.PromotionCode | null) =>
  ({
    data: promo ? [promo] : [],
  }) as unknown as Stripe.ApiList<Stripe.PromotionCode>

beforeEach(async () => {
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
        name: 'Free robocall: landline voters in a selection of precincts',
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
    await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: orgSlug,
        outreachType: 'robocall',
        status: OutreachStatus.pending,
      },
    })

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
})

describe('the offer code', () => {
  it('is minted for a draft on the offer list, then reused', async () => {
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
        promotion: { type: 'coupon', coupon: 'robocall-free-offer-2026-11' },
        max_redemptions: 1,
        metadata: { experiment: EXPERIMENT, campaignId: String(campaign.id) },
      }),
    )

    // The first draft now holds the code, which Stripe still lists as live.
    await service.prisma.outreachRobocall.update({
      where: { outreachId: first },
      data: { promoCode: code, promotionCodeId: 'promo_offer' },
    })
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

  it('is refused when it names another campaign', async () => {
    await enroll()
    promotionCodesList.mockResolvedValue(
      listResult(offerPromo({ campaignId: '12345' })),
    )
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
    await enroll()
    await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: orgSlug,
        outreachType: 'robocall',
        status: OutreachStatus.pending,
      },
    })
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
    await enroll()
    const draft = await createDraft(offerListId)
    expect((await applyPromo(draft)).status).toBe(HttpStatus.CREATED)
    await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: orgSlug,
        outreachType: 'robocall',
        status: OutreachStatus.pending,
      },
    })

    const result = await authorize(draft)

    expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    const satellite = await service.prisma.outreachRobocall.findUniqueOrThrow({
      where: { outreachId: draft },
    })
    expect(satellite.promoRedeemedAt).toBeNull()
  })
})
