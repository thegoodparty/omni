import { randomUUID } from 'node:crypto'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { useTestService } from '@/test-service'
import { describe, expect, it, vi } from 'vitest'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'
// GET /v1/contacts/:id validates :id as a GUID (GetPersonParamsDTO).
const PERSON_ID = '33333333-3333-4333-8333-333333333333'

// Full PersonSchema shape — both routes under test carry a @ResponseSchema,
// so every non-optional field needs a valid value or the response
// interceptor 500s the request.
const mockPersonPayload = () => ({
  id: PERSON_ID,
  lalVoterId: 'lal-1',
  firstName: 'Jane',
  middleName: null,
  lastName: 'Doe',
  nameSuffix: null,
  age: 42,
  state: 'CA',
  address: {
    line1: '123 Main St',
    line2: null,
    city: 'Townsville',
    state: 'CA',
    zip: '90210',
    zipPlus4: null,
    latitude: null,
    longitude: null,
  },
  cellPhone: '555-0100',
  landline: null,
  gender: 'Female',
  registeredVoter: 'Yes',
  estimatedIncomeAmount: null,
  voterStatus: 'Super',
  maritalStatus: null,
  hasChildrenUnder18: null,
  veteranStatus: null,
  homeowner: null,
  businessOwner: null,
  levelOfEducation: null,
  ethnicityGroup: null,
  language: 'English',
})

const stubPeopleApi = () => {
  vi.spyOn(service.app.get(VoterQueryService), 'findPerson').mockResolvedValue(
    mockPersonPayload() as never,
  )
}

// eo- orgs bypass the pro-campaign gate (hasElectedOfficeAccess), so an org
// row with a district is enough to reach findPerson through the real route.
const seedEoOrg = (slug: string) =>
  service.prisma.organization.create({
    data: {
      slug,
      ownerId: service.user.id,
      overrideDistrictId: randomUUID(),
    },
  })

const seedWinOrg = async (slug: string) => {
  await service.prisma.organization.create({
    data: {
      slug,
      ownerId: service.user.id,
      overrideDistrictId: randomUUID(),
    },
  })
  await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${slug}-campaign`,
      organizationSlug: slug,
      isPro: true,
      details: { ballotLevel: 'CITY' },
    },
  })
  vi.spyOn(service.app.get(HttpService), 'get').mockReturnValue(
    of({
      data: {
        id: slug,
        state: 'CA',
        L2DistrictType: 'City',
        L2DistrictName: 'Springfield',
      },
      status: 200,
    }) as never,
  )
}

describe('PATCH /v1/contacts/:personId/follow-up', () => {
  const patchFollowUp = (slug: string, body: { value: string }) =>
    service.client.patch(`/v1/contacts/${PERSON_ID}/follow-up`, body, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

  const getDetail = (slug: string) =>
    service.client.get(`/v1/contacts/${PERSON_ID}`, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

  it('reads as cleared before any write — nothing derives this field', async () => {
    const slug = `eo-follow-up-seed-${Date.now()}`
    await seedEoOrg(slug)
    stubPeopleApi()

    const detail = await getDetail(slug)
    expect(detail.status).toBe(200)
    expect(detail.data.followUp).toBe('cleared')
  })

  it('records a request and reads it back on findPerson', async () => {
    const slug = `eo-follow-up-set-${Date.now()}`
    await seedEoOrg(slug)
    stubPeopleApi()

    const patched = await patchFollowUp(slug, { value: 'requested' })
    expect(patched.status).toBe(200)
    expect(patched.data).toEqual({ followUp: 'requested' })

    const detail = await getDetail(slug)
    expect(detail.data.followUp).toBe('requested')

    const events = await service.prisma.contactStatusEvent.findMany({
      where: { organizationSlug: slug, personId: PERSON_ID },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      field: 'follow_up',
      fromValue: 'cleared',
      toValue: 'requested',
      source: 'manual',
      actorUserId: service.user.id,
    })
  })

  it('records clearing the flag as its own event — the latest answer wins', async () => {
    const slug = `eo-follow-up-clear-${Date.now()}`
    await seedEoOrg(slug)
    stubPeopleApi()

    await patchFollowUp(slug, { value: 'requested' })
    const cleared = await patchFollowUp(slug, { value: 'cleared' })
    expect(cleared.data).toEqual({ followUp: 'cleared' })

    const detail = await getDetail(slug)
    expect(detail.data.followUp).toBe('cleared')

    const events = await service.prisma.contactStatusEvent.findMany({
      where: { organizationSlug: slug, personId: PERSON_ID },
      orderBy: { createdAt: 'asc' },
    })
    expect(events.map((event) => event.toValue)).toEqual([
      'requested',
      'cleared',
    ])
  })

  it('an unchanged-value write records no new event', async () => {
    const slug = `eo-follow-up-noop-${Date.now()}`
    await seedEoOrg(slug)
    stubPeopleApi()

    const patched = await patchFollowUp(slug, { value: 'cleared' })
    expect(patched.status).toBe(200)
    expect(patched.data).toEqual({ followUp: 'cleared' })

    const events = await service.prisma.contactStatusEvent.findMany({
      where: { organizationSlug: slug, personId: PERSON_ID },
    })
    expect(events).toHaveLength(0)
  })

  it('does not leak another org’s flag (org-scoped)', async () => {
    const ownSlug = `eo-follow-up-own-${Date.now()}`
    const otherSlug = `eo-follow-up-other-${Date.now()}`
    await seedEoOrg(ownSlug)
    await seedEoOrg(otherSlug)
    stubPeopleApi()

    await patchFollowUp(otherSlug, { value: 'requested' })

    const detail = await getDetail(ownSlug)
    expect(detail.data.followUp).toBe('cleared')
  })

  it('400s for a Win org, and omits followUp from its person payload', async () => {
    const slug = `win-follow-up-${Date.now()}`
    await seedWinOrg(slug)
    stubPeopleApi()

    const result = await patchFollowUp(slug, { value: 'requested' })
    expect(result.status).toBe(400)

    const detail = await getDetail(slug)
    expect(detail.status).toBe(200)
    expect(detail.data.followUp).toBeUndefined()
  })

  it('400s on a value outside the field vocabulary', async () => {
    const slug = `eo-follow-up-bad-${Date.now()}`
    await seedEoOrg(slug)
    stubPeopleApi()

    const result = await patchFollowUp(slug, { value: 'maybe' })
    expect(result.status).toBe(400)
  })
})
