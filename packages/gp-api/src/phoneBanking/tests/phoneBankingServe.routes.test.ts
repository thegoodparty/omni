import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Person,
  SERVE_PHONE_BANKING_PURPOSE_VALUES,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import {
  OutreachStatus,
  OutreachType,
  VoterFileFilter,
} from '../../generated/prisma'

const service = useTestService()

const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'

const PEOPLE_PAGINATION = {
  totalResults: 0,
  currentPage: 1,
  pageSize: 1000,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
}

const fakePerson = (overrides: Partial<Person> = {}): Person => ({
  id: randomUUID(),
  lalVoterId: `LAL-${randomUUID()}`,
  firstName: 'Jane',
  middleName: null,
  lastName: 'Voter',
  nameSuffix: null,
  age: 42,
  state: 'WY',
  address: {
    line1: '123 Main St',
    line2: null,
    city: 'Cheyenne',
    state: 'WY',
    zip: '82001',
    zipPlus4: null,
    latitude: null,
    longitude: null,
  },
  cellPhone: '3075550001',
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
  ...overrides,
})

const mockPeoplePage = (people: Person[]) =>
  vi
    .spyOn(service.app.get(VoterQueryService), 'findPeople')
    .mockResolvedValue({ pagination: PEOPLE_PAGINATION, people })

describe('serve phone banking routes', () => {
  let eoSlug: string
  let filter: VoterFileFilter

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    eoSlug = `eo-pb-${suffix}`
    await service.prisma.organization.create({
      data: {
        slug: eoSlug,
        ownerId: service.user.id,
        overrideDistrictId: DISTRICT_ID,
      },
    })
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: eoSlug },
    })
    filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: eoSlug, name: 'Serve PB audience' },
    })
  })

  const eoHeaders = (slug = eoSlug) => ({
    headers: { 'x-organization-slug': slug },
  })

  const buildBody = (overrides: Record<string, unknown> = {}) => ({
    name: 'Constituent calls',
    script: 'Hi, this is a call from the office.',
    sheetCount: 1,
    voterFileFilterId: filter.id,
    purpose: 'introduce',
    ...overrides,
  })

  describe('POST /v1/phone-banking/serve/lists', () => {
    it.each(SERVE_PHONE_BANKING_PURPOSE_VALUES)(
      'creates a list for purpose %s, writing the campaignId:null envelope',
      async (purpose) => {
        mockPeoplePage([fakePerson({ cellPhone: '3075660001' })])

        const res = await service.client.post(
          '/v1/phone-banking/serve/lists',
          buildBody({ purpose }),
          eoHeaders(),
        )

        expect(res.status).toBe(201)
        expect(res.data.outreachId).not.toBeNull()

        const list = await service.prisma.phoneBankingList.findUnique({
          where: { id: res.data.id },
        })
        expect(list?.organizationSlug).toBe(eoSlug)

        const envelope = await service.prisma.outreach.findFirst({
          where: { phoneBankingListId: res.data.id },
        })
        expect(envelope).toMatchObject({
          outreachType: OutreachType.nativePhoneBanking,
          status: OutreachStatus.in_progress,
          campaignId: null,
          organizationSlug: eoSlug,
        })

        const get = await service.client.get(
          `/v1/phone-banking/lists/${res.data.id}`,
          eoHeaders(),
        )
        expect(get.status).toBe(200)
        expect(get.data.purpose).toBe(purpose)
        expect(get.data.isServe).toBe(true)
        // party stays null for a Serve org even after live enrichment.
        expect(get.data.entries[0]?.persons[0]?.party).toBeNull()
      },
    )

    it('rejects a Win-only purpose slug', async () => {
      mockPeoplePage([fakePerson()])
      const res = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({ purpose: 'persuade' }),
        { ...eoHeaders(), validateStatus: () => true },
      )
      expect(res.status).toBe(400)
      expect(await service.prisma.phoneBankingList.count()).toBe(0)
    })

    it('rejects a serve-only purpose slug on the Win route', async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const winSlug = `campaign-pb-serve-reject-${suffix}`
      await service.prisma.organization.create({
        data: {
          slug: winSlug,
          ownerId: service.user.id,
          overrideDistrictId: DISTRICT_ID,
        },
      })
      await service.prisma.campaign.create({
        data: {
          userId: service.user.id,
          slug: `pb-campaign-serve-reject-${suffix}`,
          organizationSlug: winSlug,
          isPro: true,
        },
      })
      const winFilter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: winSlug, name: 'Win audience' },
      })
      mockPeoplePage([fakePerson()])

      const res = await service.client.post(
        '/v1/phone-banking/lists',
        buildBody({
          purpose: 'explain-decision',
          voterFileFilterId: winFilter.id,
        }),
        {
          headers: { 'x-organization-slug': winSlug },
          validateStatus: () => true,
        },
      )
      expect(res.status).toBe(400)
      expect(await service.prisma.phoneBankingList.count()).toBe(0)
    })

    it('404s an organization with no ElectedOffice row', async () => {
      const bareSlug = `eo-pb-bare-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: bareSlug, ownerId: service.user.id },
      })
      mockPeoplePage([fakePerson()])

      const res = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody(),
        { ...eoHeaders(bareSlug), validateStatus: () => true },
      )
      expect(res.status).toBe(404)
      expect(await service.prisma.phoneBankingList.count()).toBe(0)
    })

    it('400s an empty audience', async () => {
      mockPeoplePage([])
      const res = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody(),
        { ...eoHeaders(), validateStatus: () => true },
      )
      expect(res.status).toBe(400)
      expect(res.data.message).toMatch(/widen the filters/)
    })

    it('a follow-up create on the same filter excludes prior-batch people', async () => {
      const first = fakePerson({ cellPhone: '3075660002' })
      mockPeoplePage([first])
      const firstRes = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({ name: 'Batch 1' }),
        eoHeaders(),
      )
      expect(firstRes.status).toBe(201)

      const second = fakePerson({ cellPhone: '3075660003' })
      mockPeoplePage([first, second])
      const secondRes = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({ name: 'Batch 2' }),
        eoHeaders(),
      )
      expect(secondRes.status).toBe(201)
      expect(secondRes.data).toMatchObject({ entryCount: 1, personCount: 1 })
      const persons = await service.prisma.phoneBankingListEntryPerson.findMany(
        { where: { entry: { phoneBankingListId: secondRes.data.id } } },
      )
      expect(persons.map((p) => p.personId)).toEqual([second.id])
    })
  })

  describe('envelope scoping + isolation with GET /v1/outreach/serve', () => {
    it('appears in the serve history list and detail, never the Win list', async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const winSlug = `campaign-pb-iso-${suffix}`
      await service.prisma.organization.create({
        data: { slug: winSlug, ownerId: service.user.id },
      })
      const winCampaign = await service.prisma.campaign.create({
        data: {
          userId: service.user.id,
          slug: `pb-campaign-iso-${suffix}`,
          organizationSlug: winSlug,
          details: {},
          data: {},
          aiContent: {},
        },
      })
      const winRow = await service.prisma.outreach.create({
        data: {
          campaignId: winCampaign.id,
          organizationSlug: winSlug,
          outreachType: OutreachType.socialMedia,
          status: OutreachStatus.completed,
          name: 'Win row',
        },
      })

      mockPeoplePage([fakePerson({ cellPhone: '3075660004' })])
      const build = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody(),
        eoHeaders(),
      )
      expect(build.status).toBe(201)

      const serveList = await service.client.get(
        '/v1/outreach/serve',
        eoHeaders(),
      )
      expect(serveList.status).toBe(200)
      expect(serveList.data.map((row: { id: number }) => row.id)).toEqual([
        build.data.outreachId,
      ])

      const serveDetail = await service.client.get(
        `/v1/outreach/serve/${build.data.outreachId}`,
        eoHeaders(),
      )
      expect(serveDetail.status).toBe(200)
      expect(serveDetail.data).toMatchObject({
        campaignId: null,
        organizationSlug: eoSlug,
        outreachType: OutreachType.nativePhoneBanking,
      })
      expect(serveDetail.data.phoneBanking).toMatchObject({
        listId: build.data.id,
        entriesTotal: 1,
        peopleTotal: 1,
      })

      const winList = await service.client.get('/v1/outreach', {
        headers: { 'x-organization-slug': winSlug },
      })
      expect(winList.status).toBe(200)
      expect(winList.data.map((row: { id: number }) => row.id)).toEqual([
        winRow.id,
      ])
    })

    it('keeps a dual-role org disjoint: ONE org holding both a Campaign and an ElectedOffice', async () => {
      // The post-election transition (ENG-10976): the same org (and slug)
      // gains an ElectedOffice while its Win row still carries that
      // organizationSlug — only the campaignId: null pin keeps a serve
      // create from being mistaken for a Win row, and vice versa.
      const dualCampaign = await service.prisma.campaign.create({
        data: {
          userId: service.user.id,
          slug: `pb-campaign-dual-${Date.now()}`,
          organizationSlug: eoSlug,
          isPro: true,
          details: {},
          data: {},
          aiContent: {},
        },
      })
      const winRow = await service.prisma.outreach.create({
        data: {
          campaignId: dualCampaign.id,
          organizationSlug: eoSlug,
          outreachType: OutreachType.socialMedia,
          status: OutreachStatus.completed,
          name: 'Win row on the dual-role org',
        },
      })

      mockPeoplePage([fakePerson({ cellPhone: '3075660006' })])
      const build = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody(),
        eoHeaders(),
      )
      expect(build.status).toBe(201)

      const serveEnvelope = await service.prisma.outreach.findFirstOrThrow({
        where: { phoneBankingListId: build.data.id },
      })
      expect(serveEnvelope.campaignId).toBeNull()
      expect(serveEnvelope.organizationSlug).toBe(eoSlug)

      const serveList = await service.client.get(
        '/v1/outreach/serve',
        eoHeaders(),
      )
      expect(serveList.status).toBe(200)
      expect(serveList.data.map((row: { id: number }) => row.id)).toEqual([
        build.data.outreachId,
      ])

      const winIdThroughServe = await service.client.get(
        `/v1/outreach/serve/${winRow.id}`,
        { ...eoHeaders(), validateStatus: () => true },
      )
      expect(winIdThroughServe.status).toBe(404)

      const winList = await service.client.get('/v1/outreach', eoHeaders())
      expect(winList.status).toBe(200)
      expect(winList.data.map((row: { id: number }) => row.id)).toEqual([
        winRow.id,
      ])
    })
  })

  describe('completion flip', () => {
    it('flips the serve envelope to completed once the last person is logged', async () => {
      const personId = randomUUID()
      mockPeoplePage([fakePerson({ id: personId, cellPhone: '3075660005' })])
      const build = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody(),
        eoHeaders(),
      )
      expect(build.status).toBe(201)
      expect(build.data.entryCount).toBe(1)
      expect(build.data.personCount).toBe(1)

      const entry = await service.prisma.phoneBankingListEntry.findFirstOrThrow(
        { where: { phoneBankingListId: build.data.id } },
      )

      const callRes = await service.client.post(
        `/v1/phone-banking/lists/${build.data.id}/calls`,
        {
          entryId: entry.id,
          outcome: 'no_answer',
        },
        eoHeaders(),
      )
      expect(callRes.status).toBe(201)
      expect(callRes.data.envelopeCompleted).toBe(true)

      const envelope = await service.prisma.outreach.findFirstOrThrow({
        where: { phoneBankingListId: build.data.id },
      })
      expect(envelope.status).toBe(OutreachStatus.completed)
    })
  })
})
