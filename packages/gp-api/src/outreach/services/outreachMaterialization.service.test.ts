import { useTestService } from '@/test-service'
import { Campaign, Outreach, OutreachType } from '@/generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PinoLogger } from 'nestjs-pino'
import type { PeopleListResponse, Person } from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { PeerlyPhoneListCaptureService } from '@/vendors/peerly/services/peerlyPhoneListCapture.service'
import { OutreachMaterializationService } from './outreachMaterialization.service'

// materializeFromCapture is private; accessed the same way as other
// private-method tests in this codebase (e.g. crmCampaigns.service.test.ts,
// campaignTcrCompliance.service.test.ts) so the test can pass a small
// `pageSize` override — calling through the public materializeOutreach
// entry point has no way to reach it, since production never overrides the
// real 1000-row SEGMENT_PAGE_SIZE.
const materializeFromCapturePrivate = (
  materialization: OutreachMaterializationService,
  campaign: Campaign,
  outreach: Outreach,
  occurredAt: Date,
  maxRecipients?: number,
  pageSize?: number,
): Promise<number | null> =>
  (
    materialization as unknown as {
      materializeFromCapture: (
        campaign: Campaign,
        outreach: Outreach,
        occurredAt: Date,
        maxRecipients?: number,
        pageSize?: number,
      ) => Promise<number | null>
    }
  ).materializeFromCapture(
    campaign,
    outreach,
    occurredAt,
    maxRecipients,
    pageSize,
  )

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
    const findContacts = vi.spyOn(contacts, 'findContacts')
    vi.spyOn(contacts, 'findContactsForFilter').mockResolvedValue(
      peoplePage(['pid-1', 'pid-2']),
    )

    await materialization.materializeOutreach(campaign, outreach)

    const rows = await robocallRowsFor(outreach.id)
    expect(rows.map((r) => r.personId)).toEqual(['pid-1', 'pid-2'])
    expect(await textRowsFor(outreach.id)).toHaveLength(0)
    expect(findContacts).not.toHaveBeenCalled()
  })

  it('forces hasLandline on the resolved filter for a robocall launch', async () => {
    const { campaign, outreach, filterId } = await seedOutreach({
      slug: 'mat-robocall-landline',
      outreachType: OutreachType.robocall,
    })
    // The 3-person filter resolves to only the 2 with landlines once
    // findContactsForFilter applies the forced hasLandline: true — the same
    // narrowing the CAS fulfillment download already applies for robocall.
    const findContactsForFilter = vi
      .spyOn(contacts, 'findContactsForFilter')
      .mockResolvedValue(peoplePage(['rc-landline-1', 'rc-landline-2']))
    const findContacts = vi.spyOn(contacts, 'findContacts')

    await materialization.materializeOutreach(campaign, outreach)

    const rows = await robocallRowsFor(outreach.id)
    expect(rows.map((r) => r.personId)).toEqual([
      'rc-landline-1',
      'rc-landline-2',
    ])
    expect(findContacts).not.toHaveBeenCalled()
    expect(findContactsForFilter).toHaveBeenCalledWith(
      expect.objectContaining({ id: filterId, hasLandline: true }),
      { resultsPerPage: 1000, page: 1 },
      expect.objectContaining({ slug: campaign.organizationSlug }),
      undefined,
      expect.any(String),
    )
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

  it('materializes every recipient with no per-launch cap', async () => {
    const { campaign, outreach } = await seedOutreach({ slug: 'mat-no-cap' })
    // Spans three mocked pages, so the loop must run past the first page —
    // and past the point a finite cap would stop it — to get everyone.
    // materializeFromFilter's `maxRecipients` safety-valve defaults to
    // Number.POSITIVE_INFINITY and nothing overrides it here, so this
    // exercises the exact unlimited production path without a 100k-row
    // fixture (a regression that reintroduces a silent finite default is
    // caught by temporarily lowering that default below `totalRecipients`
    // and confirming this same test then fails).
    const totalRecipients = 5
    const pageSize = 2
    const findContacts = vi
      .spyOn(contacts, 'findContacts')
      .mockImplementation(async (params) => {
        const page = params.page ?? 1
        const start = (page - 1) * pageSize
        const ids = Array.from(
          { length: Math.min(pageSize, Math.max(totalRecipients - start, 0)) },
          (_, i) => `pid-${start + i}`,
        )
        return peoplePage(ids, {
          totalResults: totalRecipients,
          pageSize,
          totalPages: Math.ceil(totalRecipients / pageSize),
          currentPage: page,
          hasNextPage: start + ids.length < totalRecipients,
          hasPreviousPage: page > 1,
        })
      })
    const warnSpy = vi
      .spyOn(PinoLogger.prototype, 'warn')
      .mockImplementation(() => undefined)

    try {
      await materialization.materializeOutreach(campaign, outreach)

      const count = await service.prisma.contactInteractionText.count({
        where: { outreachId: outreach.id },
      })
      expect(count).toBe(totalRecipients)
      expect(warnSpy).not.toHaveBeenCalled()
      // Proves the pager actually ran to exhaustion rather than stopping
      // early: a cap that short-circuits the loop before the last page
      // would still leave 5 rows below a 100k-row default, so the count
      // alone can't catch it. Fetching all 3 pages is what a finite cap
      // would truncate.
      expect(findContacts).toHaveBeenCalledTimes(
        Math.ceil(totalRecipients / pageSize),
      )
    } finally {
      warnSpy.mockRestore()
    }
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
      const { campaign, outreach, filterId } = await seedOutreach({
        slug: 'mat-no-capture',
        phoneListId: 9999,
      })
      vi.spyOn(contacts, 'findContacts').mockResolvedValue(
        peoplePage(['pid-1', 'pid-2']),
      )
      const warnSpy = vi
        .spyOn(PinoLogger.prototype, 'warn')
        .mockImplementation(() => undefined)

      try {
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
        const filter = await filterById(filterId)
        expect(filter.firstUsedForOutreachAt).not.toBeNull()
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('falls back to filter resolution when the phone list exists but has zero captured recipients', async () => {
      const { campaign, outreach, filterId } = await seedOutreach({
        slug: 'mat-captured-zero',
        phoneListId: 6161,
      })
      // Present phone-list row, but no recipient rows under it — the
      // present-yet-empty branch, distinct from mat-no-capture's "row never
      // existed" branch. findRecipientsPage's real first call returns [].
      await seedCapturedPhoneList({
        organizationSlug: campaign.organizationSlug,
        campaignId: campaign.id,
        peerlyListId: 6161,
        voterFileFilterId: filterId,
        personIds: [],
      })
      const findContacts = vi
        .spyOn(contacts, 'findContacts')
        .mockResolvedValue(peoplePage(['pid-1', 'pid-2']))
      const warnSpy = vi
        .spyOn(PinoLogger.prototype, 'warn')
        .mockImplementation(() => undefined)

      try {
        await materialization.materializeOutreach(campaign, outreach)

        expect(findContacts).toHaveBeenCalled()
        const rows = await textRowsFor(outreach.id)
        expect(rows.map((r) => r.personId)).toEqual(['pid-1', 'pid-2'])
        expect(warnSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            outreachId: outreach.id,
            phoneListId: 6161,
          }),
          expect.stringContaining('falling back'),
        )
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('robocall with a phoneListId still resolves the filter, never capture', async () => {
      const { campaign, outreach } = await seedOutreach({
        slug: 'mat-robocall-phonelist',
        outreachType: OutreachType.robocall,
        phoneListId: 4646,
      })
      await seedCapturedPhoneList({
        organizationSlug: campaign.organizationSlug,
        campaignId: campaign.id,
        peerlyListId: 4646,
        voterFileFilterId: null,
        personIds: ['cap-rc-1'],
      })
      const findContactsForFilter = vi
        .spyOn(contacts, 'findContactsForFilter')
        .mockResolvedValue(peoplePage(['filter-rc-1', 'filter-rc-2']))

      await materialization.materializeOutreach(campaign, outreach)

      const rows = await service.prisma.contactInteractionRobocall.findMany({
        where: { outreachId: outreach.id },
        orderBy: { personId: 'asc' },
      })
      expect(rows.map((r) => r.personId)).toEqual([
        'filter-rc-1',
        'filter-rc-2',
      ])
      expect(findContactsForFilter).toHaveBeenCalledWith(
        expect.objectContaining({ hasLandline: true }),
        { resultsPerPage: 1000, page: 1 },
        expect.objectContaining({ slug: campaign.organizationSlug }),
        undefined,
        expect.any(String),
      )
    })

    it('throws when the phone list has no capture rows and no filter exists to fall back to', async () => {
      const { campaign, outreach } = await seedOutreach({
        slug: 'mat-no-capture-no-filter',
        outreachType: OutreachType.p2p,
        phoneListId: 8888,
        withFilter: false,
      })
      const warnSpy = vi
        .spyOn(PinoLogger.prototype, 'warn')
        .mockImplementation(() => undefined)

      try {
        await expect(
          materialization.materializeOutreach(campaign, outreach),
        ).rejects.toThrow('cannot materialize')
        expect(await textRowsFor(outreach.id)).toEqual([])
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('materializes from capture when the outreach has no saved filter', async () => {
      const { campaign, outreach } = await seedOutreach({
        slug: 'mat-captured-no-filter',
        outreachType: OutreachType.p2p,
        phoneListId: 4747,
        withFilter: false,
      })
      await seedCapturedPhoneList({
        organizationSlug: campaign.organizationSlug,
        campaignId: campaign.id,
        peerlyListId: 4747,
        voterFileFilterId: null,
        personIds: ['cap-nf-1', 'cap-nf-2'],
      })
      const findContacts = vi.spyOn(contacts, 'findContacts')

      await materialization.materializeOutreach(campaign, outreach)

      const rows = await textRowsFor(outreach.id)
      expect(rows.map((r) => r.personId)).toEqual(['cap-nf-1', 'cap-nf-2'])
      expect(findContacts).not.toHaveBeenCalled()
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

    it('materializes every captured recipient across multiple findRecipientsPage calls, with no per-launch cap', async () => {
      const { campaign, outreach } = await seedOutreach({
        slug: 'mat-captured-batch',
        outreachType: OutreachType.p2p,
        phoneListId: 5151,
      })
      const phoneList = await seedCapturedPhoneList({
        organizationSlug: campaign.organizationSlug,
        campaignId: campaign.id,
        peerlyListId: 5151,
        voterFileFilterId: null,
        // The real recipient rows aren't read in this test — findRecipientsPage
        // is mocked below — but a phone list still needs at least one row to
        // exist for the capture-vs-fallback contract to be exercised honestly.
        personIds: ['unused'],
      })
      const allRecipients = ['cap-1', 'cap-2', 'cap-3', 'cap-4', 'cap-5'].map(
        (personId) => ({ personId }),
      )
      const peerlyPhoneListCapture = service.app.get(
        PeerlyPhoneListCaptureService,
      )
      // Mirrors findRecipientsPage's real skip/take contract (ordered,
      // sliced) so the N+1 sentinel behaves exactly as it would against a
      // real table — just with a pageSize of 2 instead of 1000, so 5
      // recipients span three calls instead of needing 1000+ seeded rows.
      const findRecipientsPage = vi
        .spyOn(peerlyPhoneListCapture, 'findRecipientsPage')
        .mockImplementation(async (_phoneListId, { skip, take }) =>
          allRecipients.slice(skip, skip + take),
        )
      const warnSpy = vi
        .spyOn(PinoLogger.prototype, 'warn')
        .mockImplementation(() => undefined)

      try {
        const materialized = await materializeFromCapturePrivate(
          materialization,
          campaign,
          outreach,
          new Date(),
          undefined,
          2,
        )

        expect(materialized).toBe(5)
        const rows = await textRowsFor(outreach.id)
        expect(rows.map((r) => r.personId)).toEqual([
          'cap-1',
          'cap-2',
          'cap-3',
          'cap-4',
          'cap-5',
        ])
        // Three pages of 2 for five recipients proves the skip/N+1
        // stop-condition actually advanced across calls rather than
        // returning everything in one shot.
        expect(findRecipientsPage).toHaveBeenCalledTimes(3)
        expect(findRecipientsPage).toHaveBeenNthCalledWith(1, phoneList.id, {
          skip: 0,
          take: 3,
        })
        expect(findRecipientsPage).toHaveBeenNthCalledWith(2, phoneList.id, {
          skip: 2,
          take: 3,
        })
        expect(findRecipientsPage).toHaveBeenNthCalledWith(3, phoneList.id, {
          skip: 4,
          take: 3,
        })
        expect(warnSpy).not.toHaveBeenCalled()
      } finally {
        warnSpy.mockRestore()
      }
    })
  })
})
