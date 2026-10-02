import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parsePriorityStatus,
  Person,
  SERVE_PHONE_BANKING_PURPOSE_VALUES,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { PriorityStatusService } from '@/priorities/services/priorityStatus.service'
import {
  OutreachStatus,
  OutreachType,
  PrioritySource,
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
    purpose: 'introduce_myself',
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
        buildBody({ purpose: 'persuade_voters' }),
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
          purpose: 'explain_decision',
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

  // A chat card's proposal hands the official into this flow carrying its
  // derived key and the priority it was proposed under.
  describe('a create carrying a proposal link', () => {
    const PROPOSAL_KEY = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7'

    const officePriority = async (slug = eoSlug) => {
      const office = await service.prisma.electedOffice.findFirstOrThrow({
        where: { organizationSlug: slug },
      })
      return service.prisma.priority.create({
        data: {
          electedOfficeId: office.id,
          title: 'Fix the crosswalk on Main',
          description: 'Residents raised it at three meetings running.',
          source: PrioritySource.user_stated,
        },
      })
    }

    it('links the envelope to the priority under the key', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075770001' })])
      const priority = await officePriority()

      const res = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({ proposalKey: PROPOSAL_KEY, priorityId: priority.id }),
        eoHeaders(),
      )

      expect(res.status).toBe(201)
      const envelope = await service.prisma.outreach.findUnique({
        where: { proposalKey: PROPOSAL_KEY },
      })
      expect(envelope).toMatchObject({
        id: res.data.outreachId,
        phoneBankingListId: res.data.id,
        priorityId: priority.id,
        organizationSlug: eoSlug,
      })
    })

    it('hands back the first list when the same proposal completes twice', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075770002' })])

      const first = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({ proposalKey: PROPOSAL_KEY }),
        eoHeaders(),
      )
      const second = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({ proposalKey: PROPOSAL_KEY, name: 'Again' }),
        eoHeaders(),
      )

      expect(first.status).toBe(201)
      expect(second.status).toBe(201)
      expect(second.data).toMatchObject({
        id: first.data.id,
        outreachId: first.data.outreachId,
        name: first.data.name,
        entryCount: first.data.entryCount,
        personCount: first.data.personCount,
      })
      expect(
        await service.prisma.phoneBankingList.count({
          where: { organizationSlug: eoSlug },
        }),
      ).toBe(1)
    })

    // The proposal named the check it puts out, so the list going out is
    // that side going out, recorded once however many times it completes.
    it('puts the side of the check it was proposed for out, once', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075770005' })])
      const priority = await officePriority()
      await service.prisma.priority.update({
        where: { id: priority.id },
        data: {
          status: {
            version: 3,
            steps: [
              {
                id: 'define',
                state: 'settled',
                summary: 'The crosswalk is the problem.',
                check: {
                  state: 'asked',
                  who: 'Parents on Main',
                  question: 'Is the crosswalk the problem?',
                  raised: 0,
                  offeredAt: '2026-09-30T12:00:00Z',
                },
              },
            ],
          },
        },
      })
      const body = buildBody({
        proposalKey: PROPOSAL_KEY,
        priorityId: priority.id,
        stepId: 'define',
        side: 'main',
      })

      const first = await service.client.post(
        '/v1/phone-banking/serve/lists',
        body,
        eoHeaders(),
      )
      expect(first.status).toBe(201)
      const afterFirst = parsePriorityStatus(
        (
          await service.prisma.priority.findUniqueOrThrow({
            where: { id: priority.id },
          })
        ).status,
      ).steps.find((step) => step.id === 'define')?.check
      expect(afterFirst).toMatchObject({
        state: 'out',
        who: 'Parents on Main',
        sentProposalKey: PROPOSAL_KEY,
      })
      expect(afterFirst?.sentAt).toEqual(expect.any(String))
      expect(
        await service.prisma.outreach.findUnique({
          where: { proposalKey: PROPOSAL_KEY },
        }),
      ).toMatchObject({ priorityStepId: 'define', priorityCheckSide: 'main' })

      await service.client.post(
        '/v1/phone-banking/serve/lists',
        body,
        eoHeaders(),
      )
      const afterSecond = parsePriorityStatus(
        (
          await service.prisma.priority.findUniqueOrThrow({
            where: { id: priority.id },
          })
        ).status,
      ).steps.find((step) => step.id === 'define')?.check
      expect(afterSecond?.sentAt).toBe(afterFirst?.sentAt)
    })

    // A send that happened is what is true. An official who put the check
    // off, or turned it down, and then sent it anyway changed their mind; a
    // side left deferred would be raised again about people already asked.
    it.each(['deferred', 'declined'] as const)(
      'moves a %s side to out when it is sent anyway',
      async (state) => {
        mockPeoplePage([fakePerson({ cellPhone: '3075770010' })])
        const priority = await officePriority()
        await service.prisma.priority.update({
          where: { id: priority.id },
          data: {
            status: {
              version: 3,
              steps: [
                {
                  id: 'options',
                  state: 'settled',
                  summary: 'Three ways to fix it.',
                  check: {
                    state,
                    who: 'Parents on Main',
                    question: 'Which would you back?',
                    raised: 1,
                  },
                },
              ],
            },
          },
        })

        const res = await service.client.post(
          '/v1/phone-banking/serve/lists',
          buildBody({
            proposalKey: PROPOSAL_KEY,
            priorityId: priority.id,
            stepId: 'options',
            side: 'main',
          }),
          eoHeaders(),
        )

        expect(res.status).toBe(201)
        const check = parsePriorityStatus(
          (
            await service.prisma.priority.findUniqueOrThrow({
              where: { id: priority.id },
            })
          ).status,
        ).steps.find((step) => step.id === 'options')?.check
        expect(check).toMatchObject({
          state: 'out',
          sentProposalKey: PROPOSAL_KEY,
        })
      },
    )

    // The list is built and the send stands, so a status write that fails
    // after the commit is logged rather than turning the create into a 500.
    // The priority's next turn heals it.
    it('still returns the list when the status write fails, and heals later', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075770011' })])
      const priority = await officePriority()
      const status = service.app.get(PriorityStatusService)
      vi.spyOn(status, 'recordOutreachSent').mockRejectedValueOnce(
        new Error('db hiccup'),
      )

      const res = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({
          proposalKey: PROPOSAL_KEY,
          priorityId: priority.id,
          stepId: 'define',
          side: 'main',
        }),
        eoHeaders(),
      )

      expect(res.status).toBe(201)
      expect(res.data.outreachId).toEqual(expect.any(Number))
      const defineCheck = async () =>
        parsePriorityStatus(
          (
            await service.prisma.priority.findUniqueOrThrow({
              where: { id: priority.id },
            })
          ).status,
        ).steps.find((step) => step.id === 'define')?.check
      expect(await defineCheck()).toBeUndefined()

      await status.healSends(priority.id)

      expect(await defineCheck()).toMatchObject({
        state: 'out',
        sentProposalKey: PROPOSAL_KEY,
      })
    })

    it('refuses a check on a step that carries none', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075770006' })])
      const priority = await officePriority()

      const res = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({
          proposalKey: PROPOSAL_KEY,
          priorityId: priority.id,
          stepId: 'evidence',
          side: 'main',
        }),
        eoHeaders(),
      )

      expect(res.status).toBe(400)
    })

    it('refuses a check with no proposal key to record it by', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075770008' })])
      const priority = await officePriority()

      const res = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({ priorityId: priority.id, stepId: 'define', side: 'main' }),
        eoHeaders(),
      )

      expect(res.status).toBe(400)
    })

    // Outreach the agent proposes on a priority without a check behind it:
    // linked to the priority, and the status stays as it was.
    it('links a priority alone without touching its status', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075770009' })])
      const priority = await officePriority()

      const res = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({ proposalKey: PROPOSAL_KEY, priorityId: priority.id }),
        eoHeaders(),
      )

      expect(res.status).toBe(201)
      const after = await service.prisma.priority.findUniqueOrThrow({
        where: { id: priority.id },
      })
      expect(after.status).toEqual(priority.status)
      expect(after.updatedAt).toEqual(priority.updatedAt)
    })

    it('refuses a check with no priority behind it', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075770007' })])

      const res = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({
          proposalKey: PROPOSAL_KEY,
          stepId: 'define',
          side: 'main',
        }),
        eoHeaders(),
      )

      expect(res.status).toBe(400)
    })

    it('refuses a priority that belongs to another office', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075770003' })])
      const otherSlug = `${eoSlug}-other`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })
      await service.prisma.electedOffice.create({
        data: { userId: service.user.id, organizationSlug: otherSlug },
      })
      const foreign = await officePriority(otherSlug)

      const res = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({ proposalKey: PROPOSAL_KEY, priorityId: foreign.id }),
        eoHeaders(),
      )

      expect(res.status).toBe(404)
      expect(
        await service.prisma.phoneBankingList.count({
          where: { organizationSlug: eoSlug },
        }),
      ).toBe(0)
    })

    it('refuses a key another organization already spent', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075770004' })])
      const otherSlug = `${eoSlug}-spent`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })
      await service.prisma.outreach.create({
        data: {
          campaignId: null,
          organizationSlug: otherSlug,
          proposalKey: PROPOSAL_KEY,
          outreachType: OutreachType.socialMedia,
          status: OutreachStatus.completed,
          name: 'Theirs',
        },
      })

      const res = await service.client.post(
        '/v1/phone-banking/serve/lists',
        buildBody({ proposalKey: PROPOSAL_KEY }),
        eoHeaders(),
      )

      expect(res.status).toBe(409)
      expect(
        await service.prisma.phoneBankingList.count({
          where: { organizationSlug: eoSlug },
        }),
      ).toBe(0)
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
