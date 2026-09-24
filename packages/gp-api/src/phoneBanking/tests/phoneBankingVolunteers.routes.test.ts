import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Person } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { OrganizationRole, VoterFileFilter } from '../../generated/prisma'

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

const authHeaderFor = (clerkId: string) => ({
  Authorization: `Bearer ${jwt.sign(
    { sub: clerkId },
    process.env.AUTH_SECRET!,
    { expiresIn: '1h' },
  )}`,
})

describe('phone banking volunteer admission (ENG-11050)', () => {
  let orgSlug: string
  let filter: VoterFileFilter
  let listId: number
  let outreachId: number
  let entryId: number
  let entryPersonId: string

  const orgHeaders = (extra: Record<string, string> = {}) => ({
    headers: { 'x-organization-slug': orgSlug, ...extra },
  })

  const createMemberUser = (opts: { email: string; clerkId: string }) =>
    service.prisma.user.create({
      data: { email: opts.email, clerkId: opts.clerkId },
    })

  const addMembership = (userId: number, role: OrganizationRole) =>
    service.prisma.organizationMembership.create({
      data: { organizationSlug: orgSlug, userId, role },
    })

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    orgSlug = `campaign-pbv-${suffix}`
    await service.prisma.organization.create({
      data: {
        slug: orgSlug,
        ownerId: service.user.id,
        overrideDistrictId: DISTRICT_ID,
      },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `pbv-campaign-${suffix}`,
        organizationSlug: orgSlug,
        isPro: true,
      },
    })
    filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: orgSlug, name: 'PBV audience' },
    })

    mockPeoplePage([
      fakePerson({
        id: randomUUID(),
        firstName: 'A',
        lastName: 'One',
        cellPhone: '3075559001',
      }),
    ])
    const created = await service.client.post(
      '/v1/phone-banking/lists',
      {
        name: 'Tuesday calls',
        script: 'Hi, this is a volunteer calling about the election.',
        sheetCount: 1,
        voterFileFilterId: filter.id,
        purpose: 'introduce_myself',
      },
      orgHeaders(),
    )
    expect(created.status).toBe(201)
    listId = created.data.id
    outreachId = created.data.outreachId

    const entry = await service.prisma.phoneBankingListEntry.findFirstOrThrow({
      where: { phoneBankingListId: listId },
      include: { persons: true },
    })
    entryId = entry.id
    entryPersonId = entry.persons[0]!.personId
  })

  const createVolunteer = async (clerkId: string, email: string) => {
    const volunteer = await createMemberUser({ email, clerkId })
    await addMembership(volunteer.id, OrganizationRole.volunteer)
    return volunteer
  }

  const assign = (userId: number) =>
    service.prisma.outreachAssignment.create({
      data: { organizationSlug: orgSlug, outreachId, assigneeUserId: userId },
    })

  describe('an assigned volunteer', () => {
    it('reads the list via GET lists/:id', async () => {
      const volunteer = await createVolunteer(
        'user_pbv_assigned_get',
        'pbv-assigned-get@example.com',
      )
      await assign(volunteer.id)

      const res = await service.client.get(
        `/v1/phone-banking/lists/${listId}`,
        {
          headers: {
            'x-organization-slug': orgSlug,
            ...authHeaderFor('user_pbv_assigned_get'),
          },
        },
      )

      expect(res.status).toBe(200)
      expect(res.data).toMatchObject({ id: listId })
    })

    it('logs a call outcome via POST lists/:id/calls, stamping their own actorUserId', async () => {
      const volunteer = await createVolunteer(
        'user_pbv_assigned_post',
        'pbv-assigned-post@example.com',
      )
      await assign(volunteer.id)

      const res = await service.client.post(
        `/v1/phone-banking/lists/${listId}/calls`,
        {
          entryId,
          outcome: 'answered',
          personId: entryPersonId,
          supportAnswer: 'supporter',
        },
        {
          headers: {
            'x-organization-slug': orgSlug,
            ...authHeaderFor('user_pbv_assigned_post'),
          },
        },
      )

      expect(res.status).toBe(201)
      const row =
        await service.prisma.contactInteractionPhoneBanking.findFirstOrThrow({
          where: { phoneBankingListId: listId, personId: entryPersonId },
        })
      expect(row.actorUserId).toBe(volunteer.id)
    })
  })

  describe('a volunteer with no assignment on this list', () => {
    it('404s GET lists/:id', async () => {
      await createVolunteer(
        'user_pbv_unassigned_get',
        'pbv-unassigned-get@example.com',
      )

      const res = await service.client.get(
        `/v1/phone-banking/lists/${listId}`,
        {
          headers: {
            'x-organization-slug': orgSlug,
            ...authHeaderFor('user_pbv_unassigned_get'),
          },
          validateStatus: () => true,
        },
      )

      expect(res.status).toBe(404)
    })

    it('404s POST lists/:id/calls', async () => {
      await createVolunteer(
        'user_pbv_unassigned_post',
        'pbv-unassigned-post@example.com',
      )

      const res = await service.client.post(
        `/v1/phone-banking/lists/${listId}/calls`,
        { entryId, outcome: 'answered', personId: entryPersonId },
        {
          headers: {
            'x-organization-slug': orgSlug,
            ...authHeaderFor('user_pbv_unassigned_post'),
          },
          validateStatus: () => true,
        },
      )

      expect(res.status).toBe(404)
    })
  })

  it('403s a volunteer on POST lists (create)', async () => {
    await createVolunteer('user_pbv_create', 'pbv-create@example.com')

    const res = await service.client.post(
      '/v1/phone-banking/lists',
      {
        name: 'Another list',
        script: 'Hi, this is a volunteer calling about the election.',
        sheetCount: 1,
        voterFileFilterId: filter.id,
        purpose: 'introduce_myself',
      },
      {
        headers: {
          'x-organization-slug': orgSlug,
          ...authHeaderFor('user_pbv_create'),
        },
        validateStatus: () => true,
      },
    )

    expect(res.status).toBe(403)
  })

  it('403s a volunteer on DELETE lists/:id', async () => {
    await createVolunteer('user_pbv_delete', 'pbv-delete@example.com')

    const res = await service.client.delete(
      `/v1/phone-banking/lists/${listId}`,
      {
        headers: {
          'x-organization-slug': orgSlug,
          ...authHeaderFor('user_pbv_delete'),
        },
        validateStatus: () => true,
      },
    )

    expect(res.status).toBe(403)
    expect(
      await service.prisma.phoneBankingList.findUnique({
        where: { id: listId },
      }),
    ).not.toBeNull()
  })

  it('403s a volunteer on POST serve/lists', async () => {
    const eoSlug = `eo-pbv-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
    const eoFilter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: eoSlug, name: 'Serve PBV audience' },
    })
    const volunteer = await createMemberUser({
      email: 'pbv-serve-create@example.com',
      clerkId: 'user_pbv_serve_create',
    })
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: eoSlug,
        userId: volunteer.id,
        role: OrganizationRole.volunteer,
      },
    })

    const res = await service.client.post(
      '/v1/phone-banking/serve/lists',
      {
        name: 'Constituent calls',
        script: 'Hi, this is a call from the office.',
        sheetCount: 1,
        voterFileFilterId: eoFilter.id,
        purpose: 'introduce_myself',
      },
      {
        headers: {
          'x-organization-slug': eoSlug,
          ...authHeaderFor('user_pbv_serve_create'),
        },
        validateStatus: () => true,
      },
    )

    expect(res.status).toBe(403)
  })

  describe('manager regression', () => {
    it('create/get/calls/delete are unchanged for the owner', async () => {
      const getRes = await service.client.get(
        `/v1/phone-banking/lists/${listId}`,
        orgHeaders(),
      )
      expect(getRes.status).toBe(200)

      const callRes = await service.client.post(
        `/v1/phone-banking/lists/${listId}/calls`,
        { entryId, outcome: 'answered', personId: entryPersonId },
        orgHeaders(),
      )
      expect(callRes.status).toBe(201)

      const deleteRes = await service.client.delete(
        `/v1/phone-banking/lists/${listId}`,
        orgHeaders(),
      )
      expect(deleteRes.status).toBe(204)
    })
  })

  it("404s once the volunteer's assignment is removed", async () => {
    const volunteer = await createVolunteer(
      'user_pbv_unassign',
      'pbv-unassign@example.com',
    )
    await assign(volunteer.id)

    const before = await service.client.get(
      `/v1/phone-banking/lists/${listId}`,
      {
        headers: {
          'x-organization-slug': orgSlug,
          ...authHeaderFor('user_pbv_unassign'),
        },
      },
    )
    expect(before.status).toBe(200)

    await service.prisma.outreachAssignment.delete({
      where: {
        outreachId_assigneeUserId: {
          outreachId,
          assigneeUserId: volunteer.id,
        },
      },
    })

    const after = await service.client.get(
      `/v1/phone-banking/lists/${listId}`,
      {
        headers: {
          'x-organization-slug': orgSlug,
          ...authHeaderFor('user_pbv_unassign'),
        },
        validateStatus: () => true,
      },
    )
    expect(after.status).toBe(404)
  })
})
