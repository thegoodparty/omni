import { randomUUID } from 'node:crypto'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { useTestService } from '@/test-service'
import { describe, expect, it, vi } from 'vitest'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'
// GET /v1/contacts/:id validates id as a GUID (GetPersonParamsDTO) — unlike
// the notes/interactions routes' plain string personId param.
const PERSON_ID = '11111111-1111-4111-8111-111111111111'

const seedWinOrg = async (opts: {
  slug: string
  ownerId: number
  isPro: boolean
}) => {
  await service.prisma.organization.create({
    data: {
      slug: opts.slug,
      ownerId: opts.ownerId,
      // The ported people-db DTOs run through Zod, whose districtId is
      // z.guid() — a non-UUID placeholder fails validation here.
      overrideDistrictId: randomUUID(),
    },
  })
  await service.prisma.campaign.create({
    data: {
      userId: opts.ownerId,
      slug: `${opts.slug}-campaign`,
      organizationSlug: opts.slug,
      isPro: opts.isPro,
      // findPerson (unlike the notes routes) goes through
      // withOrgDistrictResolution's voter-data eligibility gate, which
      // resolves the override district's ballot level via election-api. Stub
      // it with a non-federal/state ballotLevel so the org is eligible
      // without a real L2 district lookup.
      details: { ballotLevel: 'CITY' },
    },
  })
  vi.spyOn(service.app.get(HttpService), 'get').mockReturnValue(
    of({
      data: {
        id: opts.slug,
        state: 'CA',
        L2DistrictType: 'City',
        L2DistrictName: 'Springfield',
      },
      status: 200,
    }) as never,
  )
}

const seedEoOrg = (slug: string) =>
  service.prisma.organization.create({
    data: {
      slug,
      ownerId: service.user.id,
      overrideDistrictId: randomUUID(),
    },
  })

describe('PATCH /v1/contacts/:personId/status', () => {
  // Full PersonSchema shape — the detail route validates its response
  // (@ResponseSchema(PersonSchema)), so every required field needs a valid
  // value, not just the ones this suite cares about.
  const mockPersonFetch = (
    overrides: { voterStatus?: string | null } = {},
  ) => ({
    id: PERSON_ID,
    lalVoterId: 'lal-1',
    firstName: 'Jane',
    middleName: null,
    lastName: 'Doe',
    nameSuffix: null,
    age: 40,
    state: 'WY',
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

  // findPerson resolves the person in-process via VoterQueryService — stub
  // that instead of the retired people-api GET.
  const stubPeopleApi = (person: ReturnType<typeof mockPersonFetch>) => {
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPerson',
    ).mockResolvedValue(person as never)
  }

  const patchStatus = (slug: string, body: { field: string; value: string }) =>
    service.client.patch(`/v1/contacts/${PERSON_ID}/status`, body, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

  const getDetail = (slug: string) =>
    service.client.get(`/v1/contacts/${PERSON_ID}`, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

  describe('write + read round trip', () => {
    it('overrides voter_likelihood and reads it back on findPerson', async () => {
      const slug = `win-pro-${Date.now()}-vl`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      stubPeopleApi(mockPersonFetch({ voterStatus: 'Unreliable' }))

      const patched = await patchStatus(slug, {
        field: 'voter_likelihood',
        value: 'super',
      })
      expect(patched.status).toBe(200)
      expect(patched.data).toMatchObject({
        voterLikelihood: 'super',
        supportStatus: 'unknown',
      })

      const detail = await getDetail(slug)
      expect(detail.status).toBe(200)
      expect(detail.data.voterLikelihood).toBe('super')
    })

    it('overrides support_status and reads it back on findPerson', async () => {
      const slug = `win-pro-${Date.now()}-ss`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      stubPeopleApi(mockPersonFetch())

      const patched = await patchStatus(slug, {
        field: 'support_status',
        value: 'undecided',
      })
      expect(patched.status).toBe(200)
      expect(patched.data.supportStatus).toBe('undecided')

      const detail = await getDetail(slug)
      expect(detail.status).toBe(200)
      expect(detail.data.supportStatus).toBe('undecided')
    })
  })

  describe('rejections', () => {
    it('400s for an eo- org', async () => {
      const slug = `eo-${Date.now()}`
      await seedEoOrg(slug)
      stubPeopleApi(mockPersonFetch())

      const result = await patchStatus(slug, {
        field: 'voter_likelihood',
        value: 'super',
      })
      expect(result.status).toBe(400)
    })

    it('400s for a non-pro Win campaign', async () => {
      const slug = `win-nonpro-${Date.now()}`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: false })
      stubPeopleApi(mockPersonFetch())

      const result = await patchStatus(slug, {
        field: 'voter_likelihood',
        value: 'super',
      })
      expect(result.status).toBe(400)
    })

    it('400s on a value outside the field vocabulary', async () => {
      const slug = `win-pro-${Date.now()}-bad-value`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      stubPeopleApi(mockPersonFetch())

      const result = await patchStatus(slug, {
        field: 'voter_likelihood',
        value: 'not_a_real_value',
      })
      expect(result.status).toBe(400)
    })

    it('400s on field: opt_in_status — the DTO has no such member', async () => {
      const slug = `win-pro-${Date.now()}-opt-in`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      stubPeopleApi(mockPersonFetch())

      const result = await patchStatus(slug, {
        field: 'opt_in_status',
        value: 'opted_in',
      })
      expect(result.status).toBe(400)
    })
  })

  describe('seed mapping and idempotency', () => {
    it('reads the seed mapping before any override, then the override after, with the correct fromValue', async () => {
      const slug = `win-pro-${Date.now()}-seed`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      stubPeopleApi(mockPersonFetch({ voterStatus: 'Unreliable' }))

      const before = await getDetail(slug)
      expect(before.data.voterLikelihood).toBe('unreliable')

      await patchStatus(slug, { field: 'voter_likelihood', value: 'super' })

      const after = await getDetail(slug)
      expect(after.data.voterLikelihood).toBe('super')

      const events = await service.prisma.contactStatusEvent.findMany({
        where: { organizationSlug: slug, personId: PERSON_ID },
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        fromValue: 'unreliable',
        toValue: 'super',
      })
    })

    it('an unchanged-value write is a no-op — no new event row', async () => {
      const slug = `win-pro-${Date.now()}-noop`
      await seedWinOrg({ slug, ownerId: service.user.id, isPro: true })
      stubPeopleApi(mockPersonFetch({ voterStatus: 'Super' }))

      // Seed already reads as 'super' — writing 'super' again should not
      // record a new event.
      const patched = await patchStatus(slug, {
        field: 'voter_likelihood',
        value: 'super',
      })
      expect(patched.status).toBe(200)
      expect(patched.data.voterLikelihood).toBe('super')

      const events = await service.prisma.contactStatusEvent.findMany({
        where: { organizationSlug: slug, personId: PERSON_ID },
      })
      expect(events).toHaveLength(0)

      // A genuine change still records exactly one event afterward.
      await patchStatus(slug, { field: 'voter_likelihood', value: 'unlikely' })
      const eventsAfterChange =
        await service.prisma.contactStatusEvent.findMany({
          where: { organizationSlug: slug, personId: PERSON_ID },
        })
      expect(eventsAfterChange).toHaveLength(1)
    })
  })
})
