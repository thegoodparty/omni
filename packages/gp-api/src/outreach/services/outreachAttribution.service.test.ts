import { useTestService } from '@/test-service'
import {
  Campaign,
  Outreach,
  OutreachType,
  VoterOutreachAttributionSource,
} from '@/generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PeopleListResponse, Person } from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FeaturesService } from '@/features/services/features.service'
import { OutreachAttributionService } from './outreachAttribution.service'

const service = useTestService()

const makePerson = (lalVoterId: string): Person => ({
  id: `pid-${lalVoterId}`,
  lalVoterId,
  firstName: null,
  middleName: null,
  lastName: null,
  nameSuffix: null,
  age: null,
  state: 'NC',
  address: {
    line1: null,
    line2: null,
    city: null,
    state: null,
    zip: null,
    zipPlus4: null,
    latitude: null,
    longitude: null,
  },
  cellPhone: null,
  landline: null,
  gender: null,
  politicalParty: 'Independent',
  registeredVoter: 'Yes',
  estimatedIncomeAmount: null,
  voterStatus: null,
  maritalStatus: null,
  hasChildrenUnder18: null,
  veteranStatus: null,
  homeowner: null,
  businessOwner: null,
  levelOfEducation: null,
  ethnicityGroup: null,
  language: 'English',
})

const peoplePage = (
  ids: string[],
  pagination: Partial<PeopleListResponse['pagination']> = {},
): PeopleListResponse => ({
  people: ids.map(makePerson),
  pagination: {
    totalResults: ids.length,
    currentPage: 1,
    pageSize: ids.length,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
    ...pagination,
  },
})

describe('OutreachAttributionService', () => {
  let attribution: OutreachAttributionService
  let contacts: ContactsService
  let features: FeaturesService

  const seedOutreach = async (opts: {
    slug: string
    outreachType?: OutreachType
    withFilter?: boolean
    date?: Date
  }): Promise<{ campaign: Campaign; outreach: Outreach }> => {
    const {
      slug,
      outreachType = OutreachType.phoneBanking,
      withFilter = true,
      date = null,
    } = opts
    await service.prisma.organization.create({
      data: { slug: `org-${slug}`, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug,
        organizationSlug: `org-${slug}`,
      },
    })
    const filter = withFilter
      ? await service.prisma.voterFileFilter.create({
          data: { organizationSlug: `org-${slug}`, name: 'segment' },
        })
      : null
    const outreach = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        outreachType,
        voterFileFilterId: filter?.id ?? null,
        date,
      },
    })
    return { campaign, outreach }
  }

  const activitiesFor = (outreachId: number) =>
    service.prisma.voterOutreachActivity.findMany({
      where: { outreachId },
      orderBy: { lalVoterId: 'asc' },
    })

  beforeEach(() => {
    attribution = service.app.get(OutreachAttributionService)
    contacts = service.app.get(ContactsService)
    features = service.app.get(FeaturesService)
    vi.spyOn(features, 'isFeatureEnabled').mockResolvedValue(true)
  })

  it('emits one segmentDerived activity per voter in the segment', async () => {
    const { campaign, outreach } = await seedOutreach({ slug: 'pb-emit' })
    vi.spyOn(contacts, 'findContacts').mockResolvedValue(
      peoplePage(['LAL-1', 'LAL-2', 'LAL-3']),
    )

    await attribution.recordSegmentAttribution(service.user, campaign, outreach)

    const rows = await activitiesFor(outreach.id)
    expect(rows.map((r) => r.lalVoterId)).toEqual(['LAL-1', 'LAL-2', 'LAL-3'])
    expect(rows.every((r) => r.campaignId === campaign.id)).toBe(true)
    expect(
      rows.every((r) => r.outreachType === OutreachType.phoneBanking),
    ).toBe(true)
    expect(
      rows.every(
        (r) =>
          r.attributionSource === VoterOutreachAttributionSource.segmentDerived,
      ),
    ).toBe(true)
  })

  it('uses the outreach send date as occurredAt', async () => {
    const date = new Date('2026-05-01T00:00:00.000Z')
    const { campaign, outreach } = await seedOutreach({
      slug: 'pb-date',
      date,
    })
    vi.spyOn(contacts, 'findContacts').mockResolvedValue(peoplePage(['LAL-9']))

    await attribution.recordSegmentAttribution(service.user, campaign, outreach)

    const rows = await activitiesFor(outreach.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.occurredAt).toEqual(date)
  })

  it('is idempotent: a relaunch does not duplicate records', async () => {
    const { campaign, outreach } = await seedOutreach({ slug: 'pb-retry' })
    vi.spyOn(contacts, 'findContacts').mockResolvedValue(
      peoplePage(['LAL-1', 'LAL-2']),
    )

    await attribution.recordSegmentAttribution(service.user, campaign, outreach)
    await attribution.recordSegmentAttribution(service.user, campaign, outreach)

    const rows = await activitiesFor(outreach.id)
    expect(rows.map((r) => r.lalVoterId)).toEqual(['LAL-1', 'LAL-2'])
  })

  it('pages through a large segment and covers every voter', async () => {
    const { campaign, outreach } = await seedOutreach({ slug: 'pb-batch' })
    const findContacts = vi
      .spyOn(contacts, 'findContacts')
      .mockResolvedValueOnce(
        peoplePage(['LAL-1', 'LAL-2'], {
          totalResults: 3,
          pageSize: 2,
          totalPages: 2,
          currentPage: 1,
          hasNextPage: true,
        }),
      )
      .mockResolvedValueOnce(
        peoplePage(['LAL-3'], {
          totalResults: 3,
          pageSize: 2,
          totalPages: 2,
          currentPage: 2,
          hasNextPage: false,
          hasPreviousPage: true,
        }),
      )

    await attribution.recordSegmentAttribution(service.user, campaign, outreach)

    const rows = await activitiesFor(outreach.id)
    expect(rows.map((r) => r.lalVoterId)).toEqual(['LAL-1', 'LAL-2', 'LAL-3'])
    expect(findContacts).toHaveBeenCalledTimes(2)
    expect(findContacts.mock.calls[0]?.[0]).toMatchObject({
      segment: String(outreach.voterFileFilterId),
      resultsPerPage: 1000,
      page: 1,
    })
    expect(findContacts.mock.calls[1]?.[0]).toMatchObject({ page: 2 })
  })

  it('does nothing when the win-voter-data flag is off', async () => {
    const { campaign, outreach } = await seedOutreach({ slug: 'pb-flag-off' })
    vi.spyOn(features, 'isFeatureEnabled').mockResolvedValue(false)
    const findContacts = vi.spyOn(contacts, 'findContacts')

    await attribution.recordSegmentAttribution(service.user, campaign, outreach)

    expect(findContacts).not.toHaveBeenCalled()
    expect(await activitiesFor(outreach.id)).toHaveLength(0)
  })

  it('does nothing for an unattributed channel (doorKnocking)', async () => {
    const { campaign, outreach } = await seedOutreach({
      slug: 'pb-doorknock',
      outreachType: OutreachType.doorKnocking,
    })
    const findContacts = vi.spyOn(contacts, 'findContacts')

    await attribution.recordSegmentAttribution(service.user, campaign, outreach)

    expect(findContacts).not.toHaveBeenCalled()
    expect(await activitiesFor(outreach.id)).toHaveLength(0)
  })

  it('emits segmentDerived activities for a p2p send', async () => {
    const { campaign, outreach } = await seedOutreach({
      slug: 'p2p-emit',
      outreachType: OutreachType.p2p,
    })
    vi.spyOn(contacts, 'findContacts').mockResolvedValue(
      peoplePage(['LAL-1', 'LAL-2']),
    )

    await attribution.recordSegmentAttribution(service.user, campaign, outreach)

    const rows = await activitiesFor(outreach.id)
    expect(rows.map((r) => r.lalVoterId)).toEqual(['LAL-1', 'LAL-2'])
    expect(rows.every((r) => r.outreachType === OutreachType.p2p)).toBe(true)
    // segmentDerived, not recipient: attribution resolves the segment, not the
    // SMS-reachable Peerly phone list the texts actually went to.
    expect(
      rows.every(
        (r) =>
          r.attributionSource === VoterOutreachAttributionSource.segmentDerived,
      ),
    ).toBe(true)
  })

  it('emits segmentDerived activities for a text send', async () => {
    const { campaign, outreach } = await seedOutreach({
      slug: 'text-emit',
      outreachType: OutreachType.text,
    })
    vi.spyOn(contacts, 'findContacts').mockResolvedValue(peoplePage(['LAL-7']))

    await attribution.recordSegmentAttribution(service.user, campaign, outreach)

    const rows = await activitiesFor(outreach.id)
    expect(rows.map((r) => r.lalVoterId)).toEqual(['LAL-7'])
    expect(rows[0]?.outreachType).toBe(OutreachType.text)
    expect(rows[0]?.attributionSource).toBe(
      VoterOutreachAttributionSource.segmentDerived,
    )
  })

  it('does nothing when the outreach has no segment', async () => {
    const { campaign, outreach } = await seedOutreach({
      slug: 'pb-no-seg',
      withFilter: false,
    })
    const findContacts = vi.spyOn(contacts, 'findContacts')

    await attribution.recordSegmentAttribution(service.user, campaign, outreach)

    expect(findContacts).not.toHaveBeenCalled()
    expect(await activitiesFor(outreach.id)).toHaveLength(0)
  })
})
