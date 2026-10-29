import { randomUUID } from 'node:crypto'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { useTestService } from '@/test-service'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { FeaturesService } from '@/features/services/features.service'

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
  email: null,
  isNewContact: false,
  gender: 'Female',
  registeredVoter: 'Yes',
  estimatedIncomeAmount: null,
  voterStatus: 'Super',
  earlyVoteStatus: null,
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

describe('PATCH /v1/contacts/:personId/civic-panel', () => {
  const patchCivicPanel = (slug: string, body: { value: string }) =>
    service.client.patch(`/v1/contacts/${PERSON_ID}/civic-panel`, body, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

  const getDetail = (slug: string) =>
    service.client.get(`/v1/contacts/${PERSON_ID}`, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

  it('reads as not a member before anyone joins', async () => {
    const slug = `eo-civic-panel-seed-${Date.now()}`
    await seedEoOrg(slug)
    stubPeopleApi()

    const detail = await getDetail(slug)
    expect(detail.status).toBe(200)
    expect(detail.data.civicPanel).toBe('left')
  })

  it('records joining and leaving as their own events', async () => {
    const slug = `eo-civic-panel-set-${Date.now()}`
    await seedEoOrg(slug)
    stubPeopleApi()

    const joined = await patchCivicPanel(slug, { value: 'member' })
    expect(joined.status).toBe(200)
    expect(joined.data).toEqual({ civicPanel: 'member' })
    expect((await getDetail(slug)).data.civicPanel).toBe('member')

    await patchCivicPanel(slug, { value: 'left' })

    const events = await service.prisma.contactStatusEvent.findMany({
      where: { organizationSlug: slug, personId: PERSON_ID },
      orderBy: { createdAt: 'asc' },
    })
    expect(
      events.map(({ field, fromValue, toValue, source }) => ({
        field,
        fromValue,
        toValue,
        source,
      })),
    ).toEqual([
      {
        field: 'civic_panel',
        fromValue: 'left',
        toValue: 'member',
        source: 'manual',
      },
      {
        field: 'civic_panel',
        fromValue: 'member',
        toValue: 'left',
        source: 'manual',
      },
    ])
  })

  it('keeps the panel separate from the follow-up flag', async () => {
    const slug = `eo-civic-panel-separate-${Date.now()}`
    await seedEoOrg(slug)
    stubPeopleApi()

    await patchCivicPanel(slug, { value: 'member' })

    const detail = await getDetail(slug)
    expect(detail.data.civicPanel).toBe('member')
    expect(detail.data.followUp).toBe('cleared')
  })

  it('400s for a Win org, and omits civicPanel from its person payload', async () => {
    const slug = `win-civic-panel-${Date.now()}`
    await seedWinOrg(slug)
    stubPeopleApi()

    const result = await patchCivicPanel(slug, { value: 'member' })
    expect(result.status).toBe(400)

    const detail = await getDetail(slug)
    expect(detail.status).toBe(200)
    expect(detail.data.civicPanel).toBeUndefined()
  })

  it('404s with serve-citizen-panels off and writes nothing', async () => {
    const slug = `eo-civic-panel-flag-off-${Date.now()}`
    await seedEoOrg(slug)
    stubPeopleApi()
    const flag = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(false)
    onTestFinished(() => flag.mockRestore())

    const result = await patchCivicPanel(slug, { value: 'member' })
    expect(result.status).toBe(404)

    const events = await service.prisma.contactStatusEvent.count({
      where: { organizationSlug: slug, personId: PERSON_ID },
    })
    expect(events).toBe(0)
  })

  it('400s on a value outside the field vocabulary', async () => {
    const slug = `eo-civic-panel-bad-${Date.now()}`
    await seedEoOrg(slug)
    stubPeopleApi()

    const result = await patchCivicPanel(slug, { value: 'maybe' })
    expect(result.status).toBe(400)
  })
})

// The line under the record's toggle: the latest join or leave and when the
// office last reached the person, on the person payload for eo- orgs only.
describe('GET /v1/contacts/:id — civicPanelActivity', () => {
  const getDetail = (slug: string) =>
    service.client.get(`/v1/contacts/${PERSON_ID}`, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

  it('is empty before anything has happened', async () => {
    const slug = `eo-civic-panel-activity-empty-${Date.now()}`
    await seedEoOrg(slug)
    stubPeopleApi()

    const detail = await getDetail(slug)
    expect(detail.status).toBe(200)
    expect(detail.data.civicPanelActivity).toEqual({
      latestChange: null,
      lastReachedAt: null,
    })
  })

  it('carries the latest change and the last time they were reached', async () => {
    const slug = `eo-civic-panel-activity-${Date.now()}`
    await seedEoOrg(slug)
    stubPeopleApi()
    await service.client.patch(
      `/v1/contacts/${PERSON_ID}/civic-panel`,
      { value: 'member' },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )
    await service.client.patch(
      `/v1/contacts/${PERSON_ID}/civic-panel`,
      { value: 'left' },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: PERSON_ID,
        occurredAt: new Date('2026-09-30T15:00:00Z'),
      },
    })
    await service.prisma.contactInteractionPhoneBanking.create({
      data: {
        organizationSlug: slug,
        personId: PERSON_ID,
        occurredAt: new Date('2026-09-02T15:00:00Z'),
        outcome: 'answered',
      },
    })

    const detail = await getDetail(slug)
    expect(detail.data.civicPanelActivity.latestChange).toEqual({
      value: 'left',
      source: 'manual',
      at: expect.any(String),
    })
    expect(detail.data.civicPanelActivity.lastReachedAt).toBe(
      '2026-09-30T15:00:00.000Z',
    )
  })

  it('is omitted for a Win org', async () => {
    const slug = `win-civic-panel-activity-${Date.now()}`
    await seedWinOrg(slug)
    stubPeopleApi()

    const detail = await getDetail(slug)
    expect(detail.status).toBe(200)
    expect(detail.data.civicPanelActivity).toBeUndefined()
  })
})
