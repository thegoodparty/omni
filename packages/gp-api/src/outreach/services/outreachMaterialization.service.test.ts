import { useTestService } from '@/test-service'
import { Campaign, Outreach, OutreachType } from '@/generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PeopleListResponse, Person } from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OutreachMaterializationService } from './outreachMaterialization.service'

const service = useTestService()

const makePerson = (id: string): Person => ({
  id,
  lalVoterId: `lal-${id}`,
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

describe('OutreachMaterializationService', () => {
  let materialization: OutreachMaterializationService
  let contacts: ContactsService

  const seedOutreach = async (opts: {
    slug: string
    outreachType?: OutreachType
    withFilter?: boolean
  }): Promise<{ campaign: Campaign; outreach: Outreach; filterId: number }> => {
    const { slug, outreachType = OutreachType.text, withFilter = true } = opts
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
        organizationSlug: `org-${slug}`,
        voterFileFilterId: filter?.id ?? null,
      },
    })
    return { campaign, outreach, filterId: filter?.id ?? -1 }
  }

  const textRowsFor = (outreachId: number) =>
    service.prisma.contactInteractionText.findMany({
      where: { outreachId },
      orderBy: { personId: 'asc' },
    })

  const robocallRowsFor = (outreachId: number) =>
    service.prisma.contactInteractionRobocall.findMany({
      where: { outreachId },
      orderBy: { personId: 'asc' },
    })

  const filterById = (id: number) =>
    service.prisma.voterFileFilter.findUniqueOrThrow({ where: { id } })

  beforeEach(() => {
    materialization = service.app.get(OutreachMaterializationService)
    contacts = service.app.get(ContactsService)
  })

  it('writes one ContactInteractionText row per resolved person for a text send', async () => {
    const { campaign, outreach, filterId } = await seedOutreach({
      slug: 'mat-text',
    })
    vi.spyOn(contacts, 'findContacts').mockResolvedValue(
      peoplePage(['pid-1', 'pid-2']),
    )

    await materialization.materializeOutreach(campaign, outreach)

    const rows = await textRowsFor(outreach.id)
    expect(rows.map((r) => r.personId)).toEqual(['pid-1', 'pid-2'])
    expect(
      rows.every((r) => r.organizationSlug === campaign.organizationSlug),
    ).toBe(true)
    expect(rows.every((r) => r.outreachId === outreach.id)).toBe(true)
    expect(rows.every((r) => r.occurredAt instanceof Date)).toBe(true)

    const filter = await filterById(filterId)
    expect(filter.firstUsedForOutreachAt).not.toBeNull()
  })

  it('writes ContactInteractionText rows for a p2p send', async () => {
    const { campaign, outreach } = await seedOutreach({
      slug: 'mat-p2p',
      outreachType: OutreachType.p2p,
    })
    vi.spyOn(contacts, 'findContacts').mockResolvedValue(peoplePage(['pid-9']))

    await materialization.materializeOutreach(campaign, outreach)

    const rows = await textRowsFor(outreach.id)
    expect(rows.map((r) => r.personId)).toEqual(['pid-9'])
    expect(await robocallRowsFor(outreach.id)).toHaveLength(0)
  })

  it('routes robocall sends to ContactInteractionRobocall', async () => {
    const { campaign, outreach } = await seedOutreach({
      slug: 'mat-robocall',
      outreachType: OutreachType.robocall,
    })
    vi.spyOn(contacts, 'findContacts').mockResolvedValue(
      peoplePage(['pid-1', 'pid-2']),
    )

    await materialization.materializeOutreach(campaign, outreach)

    const rows = await robocallRowsFor(outreach.id)
    expect(rows.map((r) => r.personId)).toEqual(['pid-1', 'pid-2'])
    expect(await textRowsFor(outreach.id)).toHaveLength(0)
  })

  it('skips materialization for doorKnocking outreach', async () => {
    const { campaign, outreach, filterId } = await seedOutreach({
      slug: 'mat-doorknock',
      outreachType: OutreachType.doorKnocking,
    })
    const findContacts = vi.spyOn(contacts, 'findContacts')

    await materialization.materializeOutreach(campaign, outreach)

    expect(findContacts).not.toHaveBeenCalled()
    expect(await textRowsFor(outreach.id)).toHaveLength(0)
    expect(await robocallRowsFor(outreach.id)).toHaveLength(0)
    // Not-materialized channels also don't consume the lock.
    const filter = await filterById(filterId)
    expect(filter.firstUsedForOutreachAt).toBeNull()
  })

  it('does nothing when the outreach has no voterFileFilterId', async () => {
    const { campaign, outreach } = await seedOutreach({
      slug: 'mat-no-filter',
      withFilter: false,
    })
    const findContacts = vi.spyOn(contacts, 'findContacts')

    await materialization.materializeOutreach(campaign, outreach)

    expect(findContacts).not.toHaveBeenCalled()
    expect(await textRowsFor(outreach.id)).toHaveLength(0)
  })

  it('is idempotent: relaunching does not duplicate rows', async () => {
    const { campaign, outreach } = await seedOutreach({ slug: 'mat-retry' })
    vi.spyOn(contacts, 'findContacts').mockResolvedValue(
      peoplePage(['pid-1', 'pid-2']),
    )

    await materialization.materializeOutreach(campaign, outreach)
    await materialization.materializeOutreach(campaign, outreach)

    const rows = await textRowsFor(outreach.id)
    expect(rows.map((r) => r.personId)).toEqual(['pid-1', 'pid-2'])
  })

  it('pages through a large filter and covers every person', async () => {
    const { campaign, outreach } = await seedOutreach({ slug: 'mat-batch' })
    const findContacts = vi
      .spyOn(contacts, 'findContacts')
      .mockResolvedValueOnce(
        peoplePage(['pid-1', 'pid-2'], {
          totalResults: 3,
          pageSize: 2,
          totalPages: 2,
          currentPage: 1,
          hasNextPage: true,
        }),
      )
      .mockResolvedValueOnce(
        peoplePage(['pid-3'], {
          totalResults: 3,
          pageSize: 2,
          totalPages: 2,
          currentPage: 2,
          hasNextPage: false,
          hasPreviousPage: true,
        }),
      )

    await materialization.materializeOutreach(campaign, outreach)

    const rows = await textRowsFor(outreach.id)
    expect(rows.map((r) => r.personId)).toEqual(['pid-1', 'pid-2', 'pid-3'])
    expect(findContacts).toHaveBeenCalledTimes(2)
    expect(findContacts.mock.calls[0]?.[0]).toMatchObject({
      segment: String(outreach.voterFileFilterId),
      resultsPerPage: 1000,
      page: 1,
    })
    expect(findContacts.mock.calls[1]?.[0]).toMatchObject({ page: 2 })
  })

  it('propagates a people-api failure to the caller (best-effort lives in OutreachService)', async () => {
    const { campaign, outreach } = await seedOutreach({ slug: 'mat-fail' })
    vi.spyOn(contacts, 'findContacts').mockRejectedValue(
      new Error('people-api down'),
    )

    await expect(
      materialization.materializeOutreach(campaign, outreach),
    ).rejects.toThrow('people-api down')
  })
})
