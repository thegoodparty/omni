import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FREE_TEXTS_OFFER } from '@/shared/constants/freeTextsOffer'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'
import { PhoneListState } from '@/vendors/peerly/peerly.types'
import { PeerlyPhoneListService } from '@/vendors/peerly/services/peerlyPhoneList.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { PurchaseType } from '@/payments/purchase.types'
import {
  Campaign,
  OutreachStatus,
  OutreachType,
  PhoneListBuildStatus,
  Prisma,
} from '../../generated/prisma'

// A p2p checkout is priced from the audience of the draft being paid for.
// Everything in the checkout metadata is client-controlled, so these go
// through the real HTTP routes and read the amount off what the Stripe
// session was created with.
const service = useTestService()

const DRAFT_LIST_LEADS = 8_000
const OTHER_LIST_LEADS = 10
const DRAFT_PEERLY_LIST_ID = 910_001
const OTHER_PEERLY_LIST_ID = 910_002

let campaign: Campaign
let draftBuildId: string
let otherBuildId: string
let savedListId: number
let checkout: MockInstance<StripeService['createCustomCheckoutSession']>
let holdBillingEnabled = false

const leadsByListId: Record<number, number> = {
  [DRAFT_PEERLY_LIST_ID]: DRAFT_LIST_LEADS,
  [OTHER_PEERLY_LIST_ID]: OTHER_LIST_LEADS,
}

const seedCampaign = async (
  id: number,
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
) => {
  const slug = `p2p-pricing-${id}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      id,
      slug,
      organizationSlug: slug,
      userId: service.user.id,
      isPro: true,
      details: {},
      ...overrides,
    },
  })
}

beforeEach(async () => {
  holdBillingEnabled = false
  campaign = await seedCampaign(4401)

  const savedList = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: campaign.organizationSlug, name: 'saved list' },
  })
  savedListId = savedList.id

  // Two built lists this campaign uploaded: the one the draft sends to, and
  // a much smaller one that must have no bearing on the price.
  const draftBuild = await service.prisma.peerlyPhoneList.create({
    data: {
      organizationSlug: campaign.organizationSlug,
      campaignId: campaign.id,
      token: 'draft-list-token',
      peerlyListId: DRAFT_PEERLY_LIST_ID,
      buildStatus: PhoneListBuildStatus.ready,
      leadsLoaded: DRAFT_LIST_LEADS,
      voterFileFilterId: savedListId,
    },
  })
  draftBuildId = draftBuild.id
  const otherBuild = await service.prisma.peerlyPhoneList.create({
    data: {
      organizationSlug: campaign.organizationSlug,
      campaignId: campaign.id,
      token: 'other-list-token',
      peerlyListId: OTHER_PEERLY_LIST_ID,
      buildStatus: PhoneListBuildStatus.ready,
      leadsLoaded: OTHER_LIST_LEADS,
      voterFileFilterId: savedListId,
    },
  })
  otherBuildId = otherBuild.id

  const peerly = service.app.get(PeerlyPhoneListService)
  vi.spyOn(peerly, 'checkPhoneListStatus').mockImplementation(
    async (token: string) => ({
      Data: {
        list_id:
          token === 'draft-list-token'
            ? DRAFT_PEERLY_LIST_ID
            : OTHER_PEERLY_LIST_ID,
        list_state: PhoneListState.ACTIVE,
      },
    }),
  )
  vi.spyOn(peerly, 'getPhoneListDetails').mockImplementation(
    // Pricing only reads leads_loaded off this response.
    (async (listId: number) => ({
      leads_loaded: leadsByListId[listId] ?? 0,
    })) as unknown as PeerlyPhoneListService['getPhoneListDetails'],
  )

  checkout = vi
    .spyOn(service.app.get(StripeService), 'createCustomCheckoutSession')
    .mockResolvedValue({ id: 'cs_p2p', clientSecret: 'secret', amount: 0 })

  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(async () => holdBillingEnabled)
})

const seedDraft = (data: Partial<Prisma.OutreachUncheckedCreateInput> = {}) =>
  service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: campaign.organizationSlug,
      outreachType: OutreachType.p2p,
      status: OutreachStatus.pending_payment,
      phoneListId: DRAFT_PEERLY_LIST_ID,
      voterFileFilterId: savedListId,
      textCount: DRAFT_LIST_LEADS,
      ...data,
    },
  })

const orgHeaders = (slug = campaign.organizationSlug) => ({
  headers: { 'x-organization-slug': slug },
})

const createSession = (metadata: Record<string, unknown>) =>
  service.client.post(
    '/v1/payments/purchase/create-checkout-session',
    { type: PurchaseType.TEXT, metadata },
    orgHeaders(),
  )

// What a client naming the small list sends: both its count and its build id
// understate the send.
const understatedMetadata = (outreachId: number | undefined) => ({
  outreachType: 'p2p',
  outreachId,
  contactCount: OTHER_LIST_LEADS,
  audienceSize: OTHER_LIST_LEADS,
  phoneListBuildId: otherBuildId,
})

const sessionAmount = () => checkout.mock.calls[0]?.[1]?.amount

describe('p2p checkout pricing — immediate charge', () => {
  it("charges for the draft's own list when the request names a smaller one", async () => {
    const draft = await seedDraft()

    const res = await createSession(understatedMetadata(draft.id))

    expect(res.status).toBe(201)
    expect(sessionAmount()).toBe(calcTextAmountInCents(DRAFT_LIST_LEADS))
  })

  it("applies the free-texts offer to the draft's own list, not the smaller one", async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { hasFreeTextsOffer: true },
    })
    const draft = await seedDraft()

    const res = await createSession(understatedMetadata(draft.id))

    expect(res.status).toBe(201)
    expect(sessionAmount()).toBe(
      calcTextAmountInCents(DRAFT_LIST_LEADS - FREE_TEXTS_OFFER.COUNT),
    )
  })

  it('refuses the zero-amount completion when the free offer only covers the smaller list', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { hasFreeTextsOffer: true },
    })
    const draft = await seedDraft()

    const res = await service.client.post(
      '/v1/payments/purchase/complete-free-purchase',
      {
        purchaseType: PurchaseType.TEXT,
        metadata: understatedMetadata(draft.id),
      },
      orgHeaders(),
    )

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.data)).toContain('only allowed for zero-amount')
    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: draft.id },
    })
    expect(row.status).toBe(OutreachStatus.pending_payment)
    expect(row.freePurchaseSessionId).toBeNull()
  })

  it('takes a list Peerly scrubbed to zero to the $0 path without minting a session', async () => {
    leadsByListId[DRAFT_PEERLY_LIST_ID] = 0
    try {
      const draft = await seedDraft()

      const res = await createSession({
        outreachType: 'p2p',
        outreachId: draft.id,
        contactCount: 0,
        audienceSize: 0,
      })

      expect(res.status).toBe(201)
      expect(res.data).toMatchObject({ amount: 0, clientSecret: '' })
      expect(checkout).not.toHaveBeenCalled()
    } finally {
      leadsByListId[DRAFT_PEERLY_LIST_ID] = DRAFT_LIST_LEADS
    }
  })

  it('400s a p2p checkout that names no draft, without minting a session', async () => {
    await seedDraft()

    const res = await createSession(understatedMetadata(undefined))

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.data)).toContain('An outreach draft is required')
    expect(checkout).not.toHaveBeenCalled()
  })

  it('400s a checkout for a draft finalize already claimed, without minting a session', async () => {
    const draft = await seedDraft({
      status: OutreachStatus.pending,
      projectId: 'peerly-job-1',
      stripeCheckoutSessionId: 'cs_first',
    })

    const res = await createSession(understatedMetadata(draft.id))

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.data)).toContain('No outreach draft found')
    expect(checkout).not.toHaveBeenCalled()
  })

  it("400s a checkout naming another campaign's draft", async () => {
    const other = await seedCampaign(4402)
    const foreignDraft = await service.prisma.outreach.create({
      data: {
        campaignId: other.id,
        organizationSlug: other.organizationSlug,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending_payment,
      },
    })

    const res = await createSession(understatedMetadata(foreignDraft.id))

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.data)).toContain('No outreach draft found')
    expect(checkout).not.toHaveBeenCalled()
  })
})

describe('p2p checkout pricing — hold billing', () => {
  beforeEach(() => {
    holdBillingEnabled = true
  })

  it.each([
    ['without', false],
    ['with', true],
  ])(
    "holds for the draft's own list when the request names a smaller build (%s the free offer)",
    async (_label, hasFreeTextsOffer) => {
      await service.prisma.campaign.update({
        where: { id: campaign.id },
        data: { hasFreeTextsOffer },
      })
      const draft = await seedDraft()

      const res = await createSession(understatedMetadata(draft.id))

      expect(res.status).toBe(201)
      // The hold is undiscounted either way; capture applies the offer.
      expect(sessionAmount()).toBe(calcTextAmountInCents(DRAFT_LIST_LEADS))
      expect(checkout).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ manualCapture: true }),
      )
      // The send cap lands on the draft's build, never the one named.
      const builds = await service.prisma.peerlyPhoneList.findMany({
        where: { id: { in: [draftBuildId, otherBuildId] } },
        select: { id: true, sendCapTexts: true },
      })
      expect(
        builds.find((build) => build.id === draftBuildId)?.sendCapTexts,
      ).toBeGreaterThanOrEqual(DRAFT_LIST_LEADS)
      expect(
        builds.find((build) => build.id === otherBuildId)?.sendCapTexts,
      ).toBeNull()
    },
  )

  describe('a draft paid before its build finished', () => {
    const queueBuild = (voterFileFilterId: number) =>
      service.prisma.peerlyPhoneList.create({
        data: {
          organizationSlug: campaign.organizationSlug,
          campaignId: campaign.id,
          buildStatus: PhoneListBuildStatus.building,
          voterFileFilterId,
          requestSnapshot: { name: 'pending list', voterFileFilterId },
        },
      })

    beforeEach(() => {
      vi.spyOn(
        service.app.get(ContactsService),
        'findContactsForFilter',
      ).mockResolvedValue({
        people: [],
        pagination: { totalResults: DRAFT_LIST_LEADS },
      } as unknown as Awaited<
        ReturnType<ContactsService['findContactsForFilter']>
      >)
    })

    it("holds the estimate of the build for the draft's own saved list", async () => {
      const build = await queueBuild(savedListId)
      const draft = await seedDraft({ phoneListId: null })

      const res = await createSession({
        ...understatedMetadata(draft.id),
        phoneListBuildId: build.id,
      })

      expect(res.status).toBe(201)
      expect(sessionAmount()).toBe(calcTextAmountInCents(DRAFT_LIST_LEADS))
    })

    it("400s a build made from a saved list other than the draft's, without minting a session", async () => {
      const otherList = await service.prisma.voterFileFilter.create({
        data: {
          organizationSlug: campaign.organizationSlug,
          name: 'another list',
        },
      })
      const build = await queueBuild(otherList.id)
      const draft = await seedDraft({ phoneListId: null })

      const res = await createSession({
        ...understatedMetadata(draft.id),
        phoneListBuildId: build.id,
      })

      expect(res.status).toBe(400)
      expect(JSON.stringify(res.data)).toContain('No phone list found')
      expect(checkout).not.toHaveBeenCalled()
    })
  })
})
