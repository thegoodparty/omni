import type { ClerkClient } from '@clerk/backend'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { RaceContextService } from '@/campaignStrategy/services/raceContext.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { FeaturesService } from '@/features/services/features.service'
import { VoterRecommendedListsService } from '@/peopleDb/services/voterRecommendedLists.service'
import { RobocallFreeOfferService } from '@/robocallFreeOffer/services/robocallFreeOffer.service'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'

// The webapp asks this on every Home, outreach, voter data and plan load for
// every Win campaign, so a campaign without the offer has to be answered
// without the district, race and warehouse reads the offer list's size needs.

const service = useTestService()

const ORG_SLUG = 'campaign-hotpath'

const NOT_OFFERED = {
  eligible: false,
  variant: 'freeOfferElectionEveRobocall',
  count: null,
  coveredCalls: null,
}

const getOffer = () =>
  service.client.get('/v1/campaigns/mine/robocall-offer', {
    headers: { 'x-organization-slug': ORG_SLUG },
  })

const setCoupon = (couponId: string | null) =>
  Object.assign(service.app.get(RobocallFreeOfferService), { couponId })

const stubRaceContext = () =>
  vi
    .spyOn(service.app.get(RaceContextService), 'getRaceContext')
    .mockResolvedValue({
      winNumberEffective: null,
      electionCode: null,
    } as never)

beforeEach(async () => {
  const clerk = service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN)
  vi.spyOn(clerk.users, 'getUser').mockResolvedValue({
    primaryEmailAddress: {
      emailAddress: service.user.email,
      verification: { status: 'verified' },
    },
  } as unknown as Awaited<ReturnType<ClerkClient['users']['getUser']>>)
  // No overrideDistrictId and no positionId: a Win campaign without voter
  // data.
  await service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id },
  })
  await service.prisma.campaign.create({
    data: {
      organizationSlug: ORG_SLUG,
      userId: service.user.id,
      slug: 'hotpath-candidate',
      isPro: true,
      details: { electionDate: '2026-11-03', raceId: 'race-1' },
      data: {},
      aiContent: {},
    },
  })
})

describe('GET /v1/campaigns/mine/robocall-offer', () => {
  it('answers not offered without any district, race or warehouse read while the coupon is unset', async () => {
    setCoupon(null)
    const resolveEligibleDistrict = vi.spyOn(
      service.app.get(ContactsService),
      'resolveEligibleDistrict',
    )
    const getRaceContext = stubRaceContext()
    const getPositionById = vi
      .spyOn(service.app.get(ElectionsService), 'getPositionById')
      .mockResolvedValue(null)
    const isFeatureEnabled = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(false)
    const reads = service.app.get(VoterRecommendedListsService)
    const precinctLandlines = vi
      .spyOn(reads, 'precinctLandlines')
      .mockResolvedValue({ precincts: [], truncated: false })
    const countForFilter = vi
      .spyOn(reads, 'countForFilter')
      .mockResolvedValue(0)

    const result = await getOffer()

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data).toEqual(NOT_OFFERED)
    expect(resolveEligibleDistrict).not.toHaveBeenCalled()
    expect(getRaceContext).not.toHaveBeenCalled()
    expect(getPositionById).not.toHaveBeenCalled()
    expect(isFeatureEnabled).not.toHaveBeenCalled()
    expect(precinctLandlines).not.toHaveBeenCalled()
    expect(countForFilter).not.toHaveBeenCalled()
  })

  // The test user is a goodparty.org owner, so every other rule passes and
  // the district is the one thing missing.
  it('answers not offered rather than 400 for a Win campaign without a district', async () => {
    setCoupon('robocall-free-offer-2026-11')
    const getRaceContext = stubRaceContext()

    const result = await getOffer()

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data).toEqual(NOT_OFFERED)
    expect(getRaceContext).not.toHaveBeenCalled()
  })
})
