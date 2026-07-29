import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { describe, expect, it, vi } from 'vitest'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'
// The ported people-db services run their DTOs through Zod, whose
// districtId field is z.guid() — unlike the retired httpService path, a
// non-UUID placeholder fails validation here.
const DISTRICT_ID = '22222222-2222-2222-2222-222222222222'

// A full PersonSchema-conformant payload: the controller's GET(:id) route now
// carries @ResponseSchema(PersonSchema) (ENG-10732), so a route test (unlike
// contactsPersonDetail.test.ts's direct contactsService.findPerson() calls,
// which never pass through the interceptor) needs every non-optional field
// present or ZodResponseInterceptor 500s the request.
const mockPersonPayload = (personId: string) => ({
  id: personId,
  lalVoterId: `lal-${personId}`,
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

// eo- (elected office) orgs bypass the pro-campaign gate
// (ContactsService.hasElectedOfficeAccess), so seeding one with
// overrideDistrictId is enough to reach findPerson through the real route
// without also standing up a pro campaign.
const seedEoOrg = (slug: string) =>
  service.prisma.organization.create({
    data: {
      slug,
      ownerId: service.user.id,
      overrideDistrictId: DISTRICT_ID,
    },
  })

describe('GET /v1/contacts/:id — Opted In/Out chip (ENG-10732)', () => {
  // GetPersonParamsDTO requires a GUID-shaped :id.
  const PERSON_ID = '11111111-1111-1111-1111-111111111111'

  it('reads optedOutAt null for a person with no text interactions', async () => {
    const slug = `eo-opted-out-none-${Date.now()}`
    await seedEoOrg(slug)
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPerson',
    ).mockResolvedValue(mockPersonPayload(PERSON_ID) as never)

    const result = await service.client.get(`/v1/contacts/${PERSON_ID}`, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(result.status).toBe(200)
    expect(result.data.optedOutAt).toBeNull()
  })

  it('reads the ISO optedOutAt when a text interaction carries one for this org', async () => {
    const slug = `eo-opted-out-yes-${Date.now()}`
    await seedEoOrg(slug)
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPerson',
    ).mockResolvedValue(mockPersonPayload(PERSON_ID) as never)
    const optedOutAt = new Date('2026-07-10T12:00:00.000Z')
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: PERSON_ID,
        occurredAt: optedOutAt,
        optedOutAt,
        manual: false,
      },
    })

    const result = await service.client.get(`/v1/contacts/${PERSON_ID}`, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(result.status).toBe(200)
    expect(result.data.optedOutAt).toBe(optedOutAt.toISOString())
  })

  it('does not leak another org’s opt-out into this org’s chip (org-scoped)', async () => {
    const ownSlug = `eo-opted-out-own-${Date.now()}`
    const otherSlug = `eo-opted-out-other-${Date.now()}`
    await seedEoOrg(ownSlug)
    await seedEoOrg(otherSlug)
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPerson',
    ).mockResolvedValue(mockPersonPayload(PERSON_ID) as never)
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: otherSlug,
        personId: PERSON_ID,
        occurredAt: new Date('2026-07-10T12:00:00.000Z'),
        optedOutAt: new Date('2026-07-10T12:00:00.000Z'),
        manual: false,
      },
    })

    const result = await service.client.get(`/v1/contacts/${PERSON_ID}`, {
      headers: { [ORG_SLUG_HEADER]: ownSlug },
    })

    expect(result.status).toBe(200)
    expect(result.data.optedOutAt).toBeNull()
  })

  it('reads the max optedOutAt when multiple text interactions exist for the person', async () => {
    const slug = `eo-opted-out-max-${Date.now()}`
    await seedEoOrg(slug)
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPerson',
    ).mockResolvedValue(mockPersonPayload(PERSON_ID) as never)
    const earlier = new Date('2026-06-01T12:00:00.000Z')
    const latest = new Date('2026-07-15T12:00:00.000Z')
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: PERSON_ID,
        occurredAt: earlier,
        optedOutAt: earlier,
        manual: false,
      },
    })
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: PERSON_ID,
        occurredAt: latest,
        optedOutAt: latest,
        manual: false,
      },
    })

    const result = await service.client.get(`/v1/contacts/${PERSON_ID}`, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(result.status).toBe(200)
    expect(result.data.optedOutAt).toBe(latest.toISOString())
  })
})
