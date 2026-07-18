import { useTestService } from '@/test-service'
import { Campaign, Outreach, OutreachType } from '@/generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PinoLogger } from 'nestjs-pino'
import type { PeopleListResponse, Person } from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
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
    phoneListId?: number
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
        phoneListId: opts.phoneListId,
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

  const seedCapturedPhoneList = async (opts: {
    organizationSlug: string
    campaignId: number
    peerlyListId: number
    voterFileFilterId: number | null
    personIds: string[]
  }) => {
    const phoneList = await service.prisma.peerlyPhoneList.create({
      data: {
        organizationSlug: opts.organizationSlug,
        campaignId: opts.campaignId,
        token: `token-${opts.peerlyListId}`,
        peerlyListId: opts.peerlyListId,
        voterFileFilterId: opts.voterFileFilterId,
      },
    })
    await service.prisma.peerlyPhoneListRecipient.createMany({
      data: opts.personIds.map((personId, i) => ({
        peerlyPhoneListId: phoneList.id,
        personId,
        phone: `+1555000${i}`,
      })),
    })
    return phoneList
  }

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

  it('locks the filter but writes no rows for doorKnocking outreach', async () => {
    const { campaign, outreach, filterId } = await seedOutreach({
      slug: 'mat-doorknock',
      outreachType: OutreachType.doorKnocking,
    })
    const findContacts = vi.spyOn(contacts, 'findContacts')

    await materialization.materializeOutreach(campaign, outreach)

    expect(findContacts).not.toHaveBeenCalled()
    expect(await textRowsFor(outreach.id)).toHaveLength(0)
    expect(await robocallRowsFor(outreach.id)).toHaveLength(0)
    // The lock is channel-agnostic: it records first use, not row writes.
    const filter = await filterById(filterId)
    expect(filter.firstUsedForOutreachAt).not.toBeNull()
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

  describe('captured phone-list recipients (feature 5)', () => {
    let voterFileFilterService: VoterFileFilterService

    beforeEach(() => {
      voterFileFilterService = service.app.get(VoterFileFilterService)
    })

    it('materializes from the captured recipients, not the resolved filter', async () => {
      const { campaign, outreach, filterId } = await seedOutreach({
        slug: 'mat-captured',
        outreachType: OutreachType.p2p,
        phoneListId: 4242,
      })
      await seedCapturedPhoneList({
        organizationSlug: campaign.organizationSlug,
        campaignId: campaign.id,
        peerlyListId: 4242,
        voterFileFilterId: filterId,
        personIds: ['cap-1', 'cap-2'],
      })
      // The filter would resolve a different (drifted) set of people — the
      // captured path must never call people-api to notice, let alone use it.
      const findContacts = vi
        .spyOn(contacts, 'findContacts')
        .mockResolvedValue(peoplePage(['drifted-1', 'drifted-2', 'drifted-3']))

      await materialization.materializeOutreach(campaign, outreach)

      const rows = await textRowsFor(outreach.id)
      expect(rows.map((r) => r.personId)).toEqual(['cap-1', 'cap-2'])
      expect(findContacts).not.toHaveBeenCalled()

      const filter = await filterById(filterId)
      expect(filter.firstUsedForOutreachAt).not.toBeNull()
    })

    it('falls back to filter resolution and logs a warning when the phone list has no captured recipients', async () => {
      const { campaign, outreach } = await seedOutreach({
        slug: 'mat-no-capture',
        phoneListId: 9999,
      })
      vi.spyOn(contacts, 'findContacts').mockResolvedValue(
        peoplePage(['pid-1', 'pid-2']),
      )
      const warnSpy = vi
        .spyOn(PinoLogger.prototype, 'warn')
        .mockImplementation(() => undefined)

      await materialization.materializeOutreach(campaign, outreach)

      const rows = await textRowsFor(outreach.id)
      expect(rows.map((r) => r.personId)).toEqual(['pid-1', 'pid-2'])
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          outreachId: outreach.id,
          phoneListId: 9999,
        }),
        expect.stringContaining('falling back'),
      )
      warnSpy.mockRestore()
    })

    it('is idempotent on the captured source: relaunching does not duplicate rows', async () => {
      const { campaign, outreach } = await seedOutreach({
        slug: 'mat-captured-retry',
        phoneListId: 4343,
      })
      await seedCapturedPhoneList({
        organizationSlug: campaign.organizationSlug,
        campaignId: campaign.id,
        peerlyListId: 4343,
        voterFileFilterId: null,
        personIds: ['cap-1', 'cap-2'],
      })

      await materialization.materializeOutreach(campaign, outreach)
      await materialization.materializeOutreach(campaign, outreach)

      const rows = await textRowsFor(outreach.id)
      expect(rows.map((r) => r.personId)).toEqual(['cap-1', 'cap-2'])
    })

    it('locks the filter on the captured path too', async () => {
      const { campaign, outreach } = await seedOutreach({
        slug: 'mat-captured-lock',
        phoneListId: 4444,
      })
      await seedCapturedPhoneList({
        organizationSlug: campaign.organizationSlug,
        campaignId: campaign.id,
        peerlyListId: 4444,
        voterFileFilterId: null,
        personIds: ['cap-1'],
      })
      const stampSpy = vi.spyOn(
        voterFileFilterService,
        'stampFirstUsedForOutreach',
      )

      await materialization.materializeOutreach(campaign, outreach)

      expect(stampSpy).toHaveBeenCalledWith(
        outreach.voterFileFilterId,
        campaign.organizationSlug,
      )
    })
  })
})
