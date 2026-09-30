import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Person, mintProposalKey } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import {
  OutreachStatus,
  OutreachType,
  Priority,
  PrioritySource,
  VoterFileFilter,
} from '../../generated/prisma'

const service = useTestService()

// A real election-api district id: the eligibility check behind a phone
// banking build resolves the district over a live call, so a fabricated uuid
// 404s there before reaching any of this module's code.
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

describe('outreach proposal routes', () => {
  let eoSlug: string
  let filter: VoterFileFilter
  let priority: Priority
  let proposalKey: string

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    eoSlug = `eo-proposal-${suffix}`
    await service.prisma.organization.create({
      data: {
        slug: eoSlug,
        ownerId: service.user.id,
        overrideDistrictId: DISTRICT_ID,
      },
    })
    const electedOffice = await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: eoSlug },
    })
    filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: eoSlug, name: 'Proposal audience' },
    })
    priority = await service.prisma.priority.create({
      data: {
        electedOfficeId: electedOffice.id,
        title: 'Fix the crosswalk on Main',
        description: 'Residents raised it at three meetings running.',
        source: PrioritySource.user_stated,
      },
    })
    proposalKey = mintProposalKey(`conversation-${suffix}`, `tool-${suffix}`)
  })

  const eoHeaders = (slug = eoSlug) => ({
    headers: { 'x-organization-slug': slug },
  })

  const allowFailure = (slug = eoSlug) => ({
    ...eoHeaders(slug),
    validateStatus: () => true,
  })

  const proposal = (overrides: Record<string, unknown> = {}) => ({
    audience: 'Neighbors within two blocks of the crossing',
    count: 90,
    channel: 'phoneBanking',
    savedFilterId: filter.id,
    listName: 'Crosswalk calls',
    message: 'Hi, calling from the office about the Main Street crossing.',
    why: 'These are the people who have to cross it every day.',
    deepLinkOnly: false,
    priorityId: priority.id,
    ...overrides,
  })

  describe('GET /v1/outreach/by-proposal-key/:proposalKey', () => {
    it('404s for a key nothing has been sent under', async () => {
      const res = await service.client.get(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        allowFailure(),
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })

    // The probe must not become an existence oracle for another office's
    // sends: an unowned key answers exactly the way an unused one does.
    it('404s for a key that belongs to another organization', async () => {
      const otherSlug = `eo-proposal-other-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })
      await service.prisma.outreach.create({
        data: {
          campaignId: null,
          organizationSlug: otherSlug,
          outreachType: OutreachType.nativePhoneBanking,
          proposalKey,
        },
      })

      const res = await service.client.get(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        allowFailure(),
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('PUT /v1/outreach/by-proposal-key/:proposalKey', () => {
    it('creates the outreach, which the probe then resolves', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075660001' })])

      const put = await service.client.put(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        proposal(),
        eoHeaders(),
      )

      expect(put.status).toBe(HttpStatus.OK)
      expect(put.data).toMatchObject({
        outreachType: OutreachType.nativePhoneBanking,
        status: OutreachStatus.in_progress,
        campaignId: null,
        organizationSlug: eoSlug,
        name: 'Crosswalk calls',
      })

      const persisted = await service.prisma.outreach.findUniqueOrThrow({
        where: { id: put.data.id },
      })
      expect(persisted.proposalKey).toBe(proposalKey)
      expect(persisted.priorityId).toBe(priority.id)

      const get = await service.client.get(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        eoHeaders(),
      )
      expect(get.status).toBe(HttpStatus.OK)
      expect(get.data.id).toBe(put.data.id)
    })

    // The double click. Nothing about the second call may reach the create.
    it('is a no-op on a repeat, returning the same outreach', async () => {
      mockPeoplePage([fakePerson({ cellPhone: '3075660002' })])

      const first = await service.client.put(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        proposal(),
        eoHeaders(),
      )
      const second = await service.client.put(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        proposal(),
        eoHeaders(),
      )

      expect(first.status).toBe(HttpStatus.OK)
      expect(second.status).toBe(HttpStatus.OK)
      expect(second.data.id).toBe(first.data.id)
      expect(
        await service.prisma.outreach.count({ where: { proposalKey } }),
      ).toBe(1)
      expect(await service.prisma.phoneBankingList.count()).toBe(1)
    })

    // The unique index, not the probe, is what stops this one: the row is
    // planted directly, so the request clears the probe and still must not
    // leave a half-built list behind.
    it('rejects a key another organization already holds, building nothing', async () => {
      const otherSlug = `eo-proposal-taken-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })
      await service.prisma.outreach.create({
        data: {
          campaignId: null,
          organizationSlug: otherSlug,
          outreachType: OutreachType.nativePhoneBanking,
          proposalKey,
        },
      })
      mockPeoplePage([fakePerson({ cellPhone: '3075660003' })])

      const res = await service.client.put(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        proposal(),
        allowFailure(),
      )

      expect(res.status).toBe(HttpStatus.CONFLICT)
      expect(await service.prisma.phoneBankingList.count()).toBe(0)
    })

    it('rejects a priority belonging to another elected office', async () => {
      const otherSlug = `eo-proposal-priority-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })
      const otherOffice = await service.prisma.electedOffice.create({
        data: { userId: service.user.id, organizationSlug: otherSlug },
      })
      const otherPriority = await service.prisma.priority.create({
        data: {
          electedOfficeId: otherOffice.id,
          title: 'Someone else’s priority',
          description: 'Not this official’s to act on.',
          source: PrioritySource.user_stated,
        },
      })

      const res = await service.client.put(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        proposal({ priorityId: otherPriority.id }),
        allowFailure(),
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
      expect(await service.prisma.phoneBankingList.count()).toBe(0)
    })

    it('rejects an archived priority', async () => {
      await service.prisma.priority.update({
        where: { id: priority.id },
        data: { archivedAt: new Date() },
      })

      const res = await service.client.put(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        proposal(),
        allowFailure(),
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
      expect(await service.prisma.phoneBankingList.count()).toBe(0)
    })

    // A card the Chief of Staff left has no priority to hang the send off.
    // JSON drops an undefined key, so `undefined` sends no priorityId at all.
    it.each([
      { label: 'omitted', priorityId: undefined },
      { label: 'null', priorityId: null },
    ])('sends with priorityId $label, writing none', async ({ priorityId }) => {
      mockPeoplePage([fakePerson({ cellPhone: '3075660004' })])

      const res = await service.client.put(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        proposal({ priorityId }),
        eoHeaders(),
      )

      expect(res.status).toBe(HttpStatus.OK)
      const persisted = await service.prisma.outreach.findUniqueOrThrow({
        where: { id: res.data.id },
      })
      expect(persisted.proposalKey).toBe(proposalKey)
      expect(persisted.priorityId).toBeNull()
    })

    it.each(['social', 'text'])(
      'refuses to send a %s proposal from the card',
      async (channel) => {
        const res = await service.client.put(
          `/v1/outreach/by-proposal-key/${proposalKey}`,
          proposal({ channel }),
          allowFailure(),
        )

        expect(res.status).toBe(HttpStatus.BAD_REQUEST)
        expect(await service.prisma.outreach.count()).toBe(0)
      },
    )

    it('refuses a deep-link-only proposal', async () => {
      const res = await service.client.put(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        proposal({ deepLinkOnly: true }),
        allowFailure(),
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(await service.prisma.outreach.count()).toBe(0)
    })

    it('refuses a proposal with no saved list behind it', async () => {
      const res = await service.client.put(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        proposal({ savedFilterId: null }),
        allowFailure(),
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(await service.prisma.outreach.count()).toBe(0)
    })
  })
})
