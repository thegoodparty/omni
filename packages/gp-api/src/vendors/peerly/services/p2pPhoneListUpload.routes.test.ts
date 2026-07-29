import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OfficeLevel,
  OutreachStatus,
  OutreachType,
} from '../../../generated/prisma'
import { PeerlyPhoneListService } from './peerlyPhoneList.service'

const service = useTestService()

const WIN_SLUG = 'campaign-p2p-phone-list'
const ORG_SLUG_HEADER = 'X-Organization-Slug'
// districtId and the resolved activity-condition id set both now flow
// through the real people-db Zod DTOs (ListPeopleDTO etc.), which require
// GUID-shaped strings — unlike the legacy people-api HTTP path, which just
// serialized these into a JSON body with no format validation.
const DISTRICT_ID = '20000000-0000-0000-0000-000000000000'
const PERSON_NO_RESPONSE = '00000000-0000-0000-0000-000000000001'
const PERSON_RESPONDED = '00000000-0000-0000-0000-000000000002'

const stubDistrict = () =>
  vi.spyOn(service.app.get(ElectionsService), 'getDistrict').mockResolvedValue({
    id: DISTRICT_ID,
    state: 'CA',
    L2DistrictType: 'County',
    L2DistrictName: 'Test County',
    projectedTurnout: null,
  } as never)

const seedWinCampaign = async (isPro = true) => {
  await service.prisma.organization.create({
    data: {
      slug: WIN_SLUG,
      ownerId: service.user.id,
      overrideDistrictId: DISTRICT_ID,
    },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${WIN_SLUG}-campaign`,
      organizationSlug: WIN_SLUG,
      isPro,
    },
  })
  await service.prisma.tcrCompliance.create({
    data: {
      campaignId: campaign.id,
      ein: '12-3456789',
      postalAddress: '123 Main St',
      committeeName: 'Test Committee',
      websiteDomain: 'example.com',
      filingUrl: 'https://example.com/filing',
      phone: '5551234567',
      email: 'test@example.com',
      officeLevel: OfficeLevel.state,
      peerlyIdentityId: 'peerly-identity-1',
    },
  })
  return campaign
}

const seedCompletedOutreach = (
  campaignId: number,
  outreachType: OutreachType,
) =>
  service.prisma.outreach.create({
    data: {
      campaignId,
      organizationSlug: WIN_SLUG,
      outreachType,
      status: OutreachStatus.completed,
    },
  })

const personPayload = (overrides: Record<string, unknown> = {}) => ({
  id: PERSON_NO_RESPONSE,
  firstName: 'Jane',
  lastName: 'Doe',
  cellPhone: '5551234567',
  address: { city: 'Springfield', state: 'CA', zip: '90210' },
  ...overrides,
})

// People data resolves through the in-process VoterQueryService now instead
// of the legacy people-api HTTP client — this suite doesn't run a real
// people-db, so the local service call is stubbed directly.
const stubPeopleApi = (people: Record<string, unknown>[]) =>
  vi.spyOn(service.app.get(VoterQueryService), 'findPeople').mockResolvedValue({
    people,
    pagination: {
      totalResults: people.length,
      currentPage: 1,
      pageSize: people.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  } as never)

// A fixed-list stub can't distinguish a real exclusion from an assertion
// that merely happens to pass — this one applies whatever `id` operator
// (`in` or `notIn`) the request actually carries against the full candidate
// pool, so CSV/recipient/count assertions only pass if gp-api genuinely
// composed and sent the right filter. The id operator is read off the
// people-db DTO's transformed FilterData (filterOperators.id).
const idOperatorOf = (dto: {
  filters?: {
    filterOperators?: { id?: { operator: string; values: string[] } }
  }
}) => dto.filters?.filterOperators?.id
const stubPeopleApiHonoringIdFilter = (candidates: Record<string, unknown>[]) =>
  vi
    .spyOn(service.app.get(VoterQueryService), 'findPeople')
    .mockImplementation(((dto: {
      filters?: {
        filterOperators?: { id?: { operator: string; values: string[] } }
      }
    }) => {
      const idFilter = idOperatorOf(dto)
      const people = candidates.filter((person) => {
        if (idFilter?.operator === 'in') {
          return idFilter.values.includes(person.id as string)
        }
        if (idFilter?.operator === 'notIn') {
          return !idFilter.values.includes(person.id as string)
        }
        return true
      })
      return Promise.resolve({
        people,
        pagination: { totalResults: people.length, hasNextPage: false },
      })
    }) as never)

const stubPeerlyUpload = (token = 'peerly-upload-token') =>
  vi
    .spyOn(service.app.get(PeerlyPhoneListService), 'uploadPhoneList')
    .mockResolvedValue(token)

// Splits candidates across successive pages by the DTO's `page` field, so a
// dedup Set that doesn't actually span the pagination loop would see each
// duplicate phone only once and pass by accident.
const stubPeopleApiPaginated = (pages: Record<string, unknown>[][]) =>
  vi
    .spyOn(service.app.get(VoterQueryService), 'findPeople')
    .mockImplementation(((dto: { page: number }) => {
      const people = pages[dto.page - 1] ?? []
      return Promise.resolve({
        people,
        pagination: {
          totalResults: pages.flat().length,
          hasNextPage: dto.page < pages.length,
        },
      })
    }) as never)

describe('POST /v1/p2p/phone-list (ENG-10728 contacts-pipeline capture)', () => {
  beforeEach(() => {
    stubDistrict()
  })

  it('resolves activityConditions through the contacts pipeline and captures exactly the CSV rows', async () => {
    const campaign = await seedWinCampaign()
    const outreach = await seedCompletedOutreach(campaign.id, OutreachType.text)
    const texts = service.app.get(ContactInteractionTextService)
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: PERSON_RESPONDED,
      occurredAt: new Date(),
      outreachId: outreach.id,
      respondedAt: new Date(),
    })
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: PERSON_NO_RESPONSE,
      occurredAt: new Date(),
      outreachId: outreach.id,
    })

    const post = stubPeopleApi([
      personPayload(),
      // null zip: unusable for Peerly geo-targeting, must be skipped from
      // both the CSV and the capture rows
      personPayload({
        id: '00000000-0000-0000-0000-0000000000f1',
        cellPhone: '5559876543',
        address: { city: 'Springfield', state: 'CA', zip: null },
      }),
    ])
    const upload = stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      {
        name: 'No response list',
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: outreach.id,
            actions: ['no_response'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)
    expect(result.data).toEqual({ token: 'peerly-upload-token' })

    // The activity condition genuinely reached the people-db query — only
    // the non-responder's id, intersected with hasCellPhone, is requested.
    // This is the exact defect the legacy voter-DB path had (it ignored
    // activityConditions entirely).
    const peopleCall = post.mock.calls[0]
    const sentFilterOperators = peopleCall?.[0].filters.filterOperators
    expect(sentFilterOperators).toMatchObject({
      hasCellPhone: { operator: 'is', value: 'not_null' },
      id: { operator: 'in', values: [PERSON_NO_RESPONSE] },
    })
    expect(Object.keys(sentFilterOperators ?? {})).toHaveLength(2)

    // The CSV Peerly received has only the header plus the one matching row.
    const uploadArgs = upload.mock.calls[0]?.[0] as { csvBuffer: Buffer }
    const csvLines = uploadArgs.csvBuffer.toString('utf-8').trim().split('\n')
    expect(csvLines).toEqual([
      'first_name,last_name,lead_phone,state,city,zip',
      'Jane,Doe,5551234567,CA,Springfield,90210',
    ])

    // Capture rows match the CSV exactly: one PeerlyPhoneList row keyed by
    // the upload token, one recipient row for the one CSV line.
    const capturedList = await service.prisma.peerlyPhoneList.findUnique({
      where: { token: 'peerly-upload-token' },
    })
    expect(capturedList).toMatchObject({
      organizationSlug: WIN_SLUG,
      campaignId: campaign.id,
      peerlyListId: null,
    })
    const recipients = await service.prisma.peerlyPhoneListRecipient.findMany({
      where: { peerlyPhoneListId: capturedList?.id },
    })
    expect(recipients).toEqual([
      expect.objectContaining({
        personId: PERSON_NO_RESPONSE,
        phone: '5551234567',
      }),
    ])
  })

  it('leaves no capture rows when the Peerly upload fails', async () => {
    const campaign = await seedWinCampaign()
    stubPeopleApi([personPayload()])
    vi.spyOn(
      service.app.get(PeerlyPhoneListService),
      'uploadPhoneList',
    ).mockRejectedValue(new Error('Peerly API ERROR'))

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Will fail' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBeGreaterThanOrEqual(400)
    expect(await service.prisma.peerlyPhoneList.count()).toBe(0)
    expect(await service.prisma.peerlyPhoneListRecipient.count()).toBe(0)
    // Sanity: the campaign row itself is unaffected by the failed upload.
    expect(
      await service.prisma.campaign.findUnique({ where: { id: campaign.id } }),
    ).not.toBeNull()
  })

  it('still blocks a non-pro Win campaign (access check inherited from the contacts pipeline)', async () => {
    await seedWinCampaign(false)
    const post = stubPeopleApi([personPayload()])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Blocked list' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBeGreaterThanOrEqual(400)
    expect(post).not.toHaveBeenCalled()
    expect(await service.prisma.peerlyPhoneList.count()).toBe(0)
  })

  it('resolves a voterFileFilterId through the saved segment criteria', async () => {
    await seedWinCampaign()
    const savedFilter = await service.prisma.voterFileFilter.create({
      data: {
        organizationSlug: WIN_SLUG,
        name: 'Democrats',
        partyDemocrat: true,
      },
    })
    const post = stubPeopleApi([personPayload()])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Segment list', voterFileFilterId: savedFilter.id },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)
    // The persisted segment's criteria drove resolution: the people-db
    // request carries the saved partyDemocrat filter, not just the (empty)
    // inline fields — plus the channel-forced hasCellPhone.
    const peopleCall = post.mock.calls[0]
    const sentFilterOperators = peopleCall?.[0].filters.filterOperators
    expect(sentFilterOperators).toMatchObject({
      politicalParty: { operator: 'eq', value: 'Democratic' },
      hasCellPhone: { operator: 'is', value: 'not_null' },
    })
    expect(Object.keys(sentFilterOperators ?? {})).toHaveLength(2)
    expect(
      await service.prisma.peerlyPhoneList.findUnique({
        where: { token: 'peerly-upload-token' },
      }),
    ).toMatchObject({ voterFileFilterId: savedFilter.id })
  })

  it('400s when no contact is uploadable instead of sending an empty CSV', async () => {
    await seedWinCampaign()
    stubPeopleApi([
      personPayload({
        id: '00000000-0000-0000-0000-0000000000f1',
        address: { city: 'Springfield', state: 'CA', zip: null },
      }),
    ])
    const upload = stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Empty list' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(400)
    expect(upload).not.toHaveBeenCalled()
    expect(await service.prisma.peerlyPhoneList.count()).toBe(0)
  })

  it('rejects a voterFileFilterId owned by another organization', async () => {
    await seedWinCampaign()
    await service.prisma.organization.create({
      data: { slug: 'other-org-p2p', ownerId: service.user.id },
    })
    const foreignFilter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: 'other-org-p2p', name: 'Not yours' },
    })
    const post = stubPeopleApi([personPayload()])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Cross-org list', voterFileFilterId: foreignFilter.id },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(400)
    expect(post).not.toHaveBeenCalled()
    expect(await service.prisma.peerlyPhoneList.count()).toBe(0)
  })
})

describe('POST /v1/p2p/phone-list (ENG-10800 opt-out scrub)', () => {
  beforeEach(() => {
    stubDistrict()
  })

  it('excludes an org-opted-out contact from the CSV and capture rows', async () => {
    const campaign = await seedWinCampaign()
    const outreach = await seedCompletedOutreach(campaign.id, OutreachType.text)
    const texts = service.app.get(ContactInteractionTextService)
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: '00000000-0000-0000-0000-0000000000aa',
      occurredAt: new Date(),
      outreachId: outreach.id,
      optedOutAt: new Date(),
    })

    const post = stubPeopleApiHonoringIdFilter([
      personPayload({ id: '00000000-0000-0000-0000-0000000000d1' }),
      personPayload({
        id: '00000000-0000-0000-0000-0000000000d2',
        cellPhone: '5559990000',
      }),
      personPayload({
        id: '00000000-0000-0000-0000-0000000000aa',
        cellPhone: '5551230000',
      }),
    ])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Scrubbed list' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)

    const sentFilterOperators = post.mock.calls[0]?.[0].filters.filterOperators
    expect(sentFilterOperators).toMatchObject({
      id: {
        operator: 'notIn',
        values: ['00000000-0000-0000-0000-0000000000aa'],
      },
      hasCellPhone: { operator: 'is', value: 'not_null' },
    })

    const capturedList = await service.prisma.peerlyPhoneList.findUnique({
      where: { token: 'peerly-upload-token' },
    })
    expect(capturedList?.excludedOptedOutCount).toBe(1)
    const recipients = await service.prisma.peerlyPhoneListRecipient.findMany({
      where: { peerlyPhoneListId: capturedList?.id },
    })
    expect(recipients).toHaveLength(2)
    expect(recipients.map((r) => r.personId)).not.toContain(
      '00000000-0000-0000-0000-0000000000aa',
    )
  })

  it('shrinks an activity-condition "in" set to the ids that are not opted out', async () => {
    const campaign = await seedWinCampaign()
    const outreach = await seedCompletedOutreach(campaign.id, OutreachType.text)
    const texts = service.app.get(ContactInteractionTextService)
    // All three match the "no_response" activity condition (respondedAt
    // null); '00000000-0000-0000-0000-0000000000aa' additionally opted out on the same row — a real
    // shape, since a "STOP" reply is itself a non-response.
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: '00000000-0000-0000-0000-0000000000e1',
      occurredAt: new Date(),
      outreachId: outreach.id,
    })
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: '00000000-0000-0000-0000-0000000000aa',
      occurredAt: new Date(),
      outreachId: outreach.id,
      optedOutAt: new Date(),
    })
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: '00000000-0000-0000-0000-0000000000e2',
      occurredAt: new Date(),
      outreachId: outreach.id,
    })

    const post = stubPeopleApiHonoringIdFilter([
      personPayload({ id: '00000000-0000-0000-0000-0000000000e1' }),
      personPayload({
        id: '00000000-0000-0000-0000-0000000000aa',
        cellPhone: '5551230000',
      }),
      personPayload({
        id: '00000000-0000-0000-0000-0000000000e2',
        cellPhone: '5559990000',
      }),
    ])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      {
        name: 'Activity condition + opt-out',
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: outreach.id,
            actions: ['no_response'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)

    // The resolved "in" set (3 ids matching the activity condition) shrank
    // to the 2 that aren't opted out, rather than the opt-out riding along
    // as a separate, illegal sibling `notIn` on the same `id` key.
    const sentFilterOperators = post.mock.calls[0]?.[0].filters.filterOperators
    expect(sentFilterOperators).toMatchObject({ id: { operator: 'in' } })
    expect(
      new Set((sentFilterOperators?.id?.values ?? []).map(String)),
    ).toEqual(
      new Set([
        '00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000e2',
      ]),
    )

    const capturedList = await service.prisma.peerlyPhoneList.findUnique({
      where: { token: 'peerly-upload-token' },
    })
    expect(capturedList?.excludedOptedOutCount).toBe(1)
    const recipients = await service.prisma.peerlyPhoneListRecipient.findMany({
      where: { peerlyPhoneListId: capturedList?.id },
    })
    expect(recipients.map((r) => r.personId).sort()).toEqual([
      '00000000-0000-0000-0000-0000000000e1',
      '00000000-0000-0000-0000-0000000000e2',
    ])
  })

  it('sends no candidates (and no illegal empty "in") when every activity-condition match opted out', async () => {
    const campaign = await seedWinCampaign()
    const outreach = await seedCompletedOutreach(campaign.id, OutreachType.text)
    const texts = service.app.get(ContactInteractionTextService)
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: '00000000-0000-0000-0000-0000000000a1',
      occurredAt: new Date(),
      outreachId: outreach.id,
      optedOutAt: new Date(),
    })
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: '00000000-0000-0000-0000-0000000000a2',
      occurredAt: new Date(),
      outreachId: outreach.id,
      optedOutAt: new Date(),
    })

    const post = stubPeopleApiHonoringIdFilter([
      personPayload({ id: '00000000-0000-0000-0000-0000000000a1' }),
      personPayload({
        id: '00000000-0000-0000-0000-0000000000a2',
        cellPhone: '5559990000',
      }),
    ])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      {
        name: 'All matches opted out',
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: outreach.id,
            actions: ['no_response'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    // No contacts survive the scrub, so the build 400s rather than uploading
    // an empty list — and it does so via the 'empty' short-circuit, never by
    // querying people-db with an illegal zero-length `in`.
    expect(result.status).toBe(400)
    expect(post).not.toHaveBeenCalled()
    expect(await service.prisma.peerlyPhoneList.count()).toBe(0)
  })

  it('does not exclude an opt-out recorded in a different organization', async () => {
    await seedWinCampaign()
    await service.prisma.organization.create({
      data: { slug: 'other-org-optout-p2p', ownerId: service.user.id },
    })
    const otherCampaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'other-org-optout-p2p-campaign',
        organizationSlug: 'other-org-optout-p2p',
      },
    })
    const otherOutreach = await service.prisma.outreach.create({
      data: {
        campaignId: otherCampaign.id,
        organizationSlug: 'other-org-optout-p2p',
        outreachType: OutreachType.text,
        status: OutreachStatus.completed,
      },
    })
    const texts = service.app.get(ContactInteractionTextService)
    await texts.create({
      organizationSlug: 'other-org-optout-p2p',
      personId: '00000000-0000-0000-0000-0000000000ab',
      occurredAt: new Date(),
      outreachId: otherOutreach.id,
      optedOutAt: new Date(),
    })

    const post = stubPeopleApi([
      personPayload({ id: '00000000-0000-0000-0000-0000000000ab' }),
    ])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Cross-org opt-out' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)
    const sentFilterOperators = post.mock.calls[0]?.[0].filters.filterOperators
    expect(sentFilterOperators).not.toHaveProperty('id')

    const capturedList = await service.prisma.peerlyPhoneList.findUnique({
      where: { token: 'peerly-upload-token' },
    })
    expect(capturedList?.excludedOptedOutCount).toBe(0)
    expect(
      await service.prisma.peerlyPhoneListRecipient.count({
        where: { peerlyPhoneListId: capturedList?.id },
      }),
    ).toBe(1)
  })

  it('is a no-op when the org has no opt-out history', async () => {
    await seedWinCampaign()
    const post = stubPeopleApi([personPayload()])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'No opt-outs' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)
    const sentFilterOperators = post.mock.calls[0]?.[0].filters.filterOperators
    expect(sentFilterOperators).not.toHaveProperty('id')

    const capturedList = await service.prisma.peerlyPhoneList.findUnique({
      where: { token: 'peerly-upload-token' },
    })
    expect(capturedList?.excludedOptedOutCount).toBe(0)
  })

  it(
    'skips the scrub and still sends when the opt-out set exceeds the ' +
      'people-api id-filter cap',
    { timeout: 30_000 },
    async () => {
      await seedWinCampaign()
      // A single INSERT ... SELECT is far cheaper than materializing 100k+
      // rows client-side; only person_id needs to vary per row.
      await service.prisma.$executeRaw`
        INSERT INTO contact_interaction_text (id, organization_slug, person_id, occurred_at, opted_out_at)
        SELECT gen_random_uuid()::text, ${WIN_SLUG}, 'cap-person-' || gen_series, now(), now()
        FROM generate_series(1, 100001) AS gen_series
      `

      const post = stubPeopleApi([personPayload()])
      stubPeerlyUpload()

      const result = await service.client.post(
        '/v1/p2p/phone-list',
        { name: 'Over the cap' },
        { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
      )

      expect(result.status).toBe(201)
      const sentFilterOperators =
        post.mock.calls[0]?.[0].filters.filterOperators
      expect(sentFilterOperators).not.toHaveProperty('id')

      const capturedList = await service.prisma.peerlyPhoneList.findUnique({
        where: { token: 'peerly-upload-token' },
      })
      expect(capturedList?.excludedOptedOutCount).toBe(0)
    },
  )

  it(
    'drops the opt-out merge (not the send) when it would combine with an ' +
      'existing notIn resolution past the people-api id-filter cap',
    { timeout: 45_000 },
    async () => {
      await seedWinCampaign()
      // supportStatus: ['unknown'] resolves to a notIn of every known
      // (non-unknown) support answer — seed enough door-knock rows that this
      // notIn alone is large, then seed an opt-out set that only pushes the
      // *combination* over the cap (each set stays under the cap on its
      // own, matching the two independent caps this scenario exercises).
      // person_id now flows through the people-db DTO's z.guid() validation,
      // so the two sets carry distinguishable GUID prefixes (10.. known,
      // 20.. opted-out) instead of the old free-form 'known-cap-N' strings.
      await service.prisma.$executeRaw`
        INSERT INTO contact_interaction_door_knock (id, organization_slug, person_id, occurred_at, outcome, support_answer)
        SELECT gen_random_uuid()::text, ${WIN_SLUG}, '10000000-0000-0000-0000-' || lpad(gen_series::text, 12, '0'), now(), 'answered', 'supporter'
        FROM generate_series(1, 60000) AS gen_series
      `
      await service.prisma.$executeRaw`
        INSERT INTO contact_interaction_text (id, organization_slug, person_id, occurred_at, opted_out_at)
        SELECT gen_random_uuid()::text, ${WIN_SLUG}, '20000000-0000-0000-0000-' || lpad(gen_series::text, 12, '0'), now(), now()
        FROM generate_series(1, 50000) AS gen_series
      `

      const post = stubPeopleApi([personPayload()])
      stubPeerlyUpload()

      const result = await service.client.post(
        '/v1/p2p/phone-list',
        { name: 'Combined cap', supportStatus: ['unknown'] },
        { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
      )

      expect(result.status).toBe(201)
      const sentNotIn = (
        post.mock.calls[0]?.[0].filters.filterOperators.id?.values ?? []
      ).map(String)
      // The support-status notIn resolution rode through unchanged (60k);
      // the opt-out ids did NOT get unioned in — proof the merge was
      // dropped rather than sent past the cap or blocking the send.
      expect(sentNotIn).toHaveLength(60_000)
      expect(sentNotIn.some((id) => id.startsWith('20000000-'))).toBe(false)
    },
  )
})

describe('POST /v1/p2p/phone-list (ENG-10801 phone dedup)', () => {
  beforeEach(() => {
    stubDistrict()
  })

  it('dedupes two people sharing a phone number within one page', async () => {
    await seedWinCampaign()
    stubPeopleApi([
      personPayload({
        id: '00000000-0000-0000-0000-0000000000c1',
        cellPhone: '5551112222',
      }),
      personPayload({
        id: '00000000-0000-0000-0000-0000000000c2',
        cellPhone: '5551112222',
      }),
    ])
    const upload = stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Shared phone' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)

    // Only the first-seen person per number reaches the CSV.
    const uploadArgs = upload.mock.calls[0]?.[0] as { csvBuffer: Buffer }
    const csvLines = uploadArgs.csvBuffer.toString('utf-8').trim().split('\n')
    expect(csvLines).toEqual([
      'first_name,last_name,lead_phone,state,city,zip',
      'Jane,Doe,5551112222,CA,Springfield,90210',
    ])

    const capturedList = await service.prisma.peerlyPhoneList.findUnique({
      where: { token: 'peerly-upload-token' },
    })
    expect(capturedList?.excludedDuplicatePhoneCount).toBe(1)
    const recipients = await service.prisma.peerlyPhoneListRecipient.findMany({
      where: { peerlyPhoneListId: capturedList?.id },
    })
    expect(recipients).toEqual([
      expect.objectContaining({
        personId: '00000000-0000-0000-0000-0000000000c1',
        phone: '5551112222',
      }),
    ])
  })

  it('dedupes a phone number shared by two people across pages', async () => {
    await seedWinCampaign()
    stubPeopleApiPaginated([
      [
        personPayload({
          id: '00000000-0000-0000-0000-000000000011',
          cellPhone: '5553334444',
        }),
      ],
      [
        personPayload({
          id: '00000000-0000-0000-0000-000000000012',
          cellPhone: '5553334444',
        }),
      ],
    ])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Cross-page duplicate' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)

    const capturedList = await service.prisma.peerlyPhoneList.findUnique({
      where: { token: 'peerly-upload-token' },
    })
    expect(capturedList?.excludedDuplicatePhoneCount).toBe(1)
    const recipients = await service.prisma.peerlyPhoneListRecipient.findMany({
      where: { peerlyPhoneListId: capturedList?.id },
    })
    expect(recipients).toEqual([
      expect.objectContaining({
        personId: '00000000-0000-0000-0000-000000000011',
        phone: '5553334444',
      }),
    ])
  })

  it('leaves distinct numbers unaffected and composes with the opt-out scrub', async () => {
    const campaign = await seedWinCampaign()
    const outreach = await seedCompletedOutreach(campaign.id, OutreachType.text)
    const texts = service.app.get(ContactInteractionTextService)
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: '00000000-0000-0000-0000-0000000000aa',
      occurredAt: new Date(),
      outreachId: outreach.id,
      optedOutAt: new Date(),
    })

    stubPeopleApiHonoringIdFilter([
      personPayload({
        id: '00000000-0000-0000-0000-000000000021',
        cellPhone: '5551110000',
      }),
      personPayload({
        id: '00000000-0000-0000-0000-000000000022',
        cellPhone: '5552220000',
      }),
      personPayload({
        id: '00000000-0000-0000-0000-0000000000b1',
        cellPhone: '5553330000',
      }),
      personPayload({
        id: '00000000-0000-0000-0000-0000000000b2',
        cellPhone: '5553330000',
      }),
      personPayload({
        id: '00000000-0000-0000-0000-0000000000aa',
        cellPhone: '5554440000',
      }),
    ])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Mixed dedup + opt-out' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)

    const capturedList = await service.prisma.peerlyPhoneList.findUnique({
      where: { token: 'peerly-upload-token' },
    })
    expect(capturedList?.excludedOptedOutCount).toBe(1)
    expect(capturedList?.excludedDuplicatePhoneCount).toBe(1)
    const recipients = await service.prisma.peerlyPhoneListRecipient.findMany({
      where: { peerlyPhoneListId: capturedList?.id },
    })
    expect(recipients.map((r) => r.personId).sort()).toEqual([
      '00000000-0000-0000-0000-000000000021',
      '00000000-0000-0000-0000-000000000022',
      '00000000-0000-0000-0000-0000000000b1',
    ])
  })
})

describe('GET /v1/p2p/phone-list/:token/status (ENG-10728 peerlyListId stamping)', () => {
  it('stamps peerlyListId once and does not clobber it on a repeat poll', async () => {
    const campaign = await seedWinCampaign()
    await service.prisma.peerlyPhoneList.create({
      data: {
        organizationSlug: WIN_SLUG,
        campaignId: campaign.id,
        token: 'poll-token',
      },
    })
    vi.spyOn(
      service.app.get(PeerlyPhoneListService),
      'checkPhoneListStatus',
    ).mockResolvedValue({
      Data: { list_state: 'ACTIVE', list_id: 555 },
    } as never)
    vi.spyOn(
      service.app.get(PeerlyPhoneListService),
      'getPhoneListDetails',
    ).mockResolvedValue({ leads_loaded: 10 } as never)

    const first = await service.client.get(
      '/v1/p2p/phone-list/poll-token/status',
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(first.status).toBe(200)
    // ENG-10808: the two exclusion counts ride along from the capture row
    // (default 0 here since this row was created without them).
    expect(first.data).toEqual({
      phoneListId: 555,
      leadsLoaded: 10,
      excludedOptedOutCount: 0,
      excludedDuplicatePhoneCount: 0,
    })

    const afterFirstPoll = await service.prisma.peerlyPhoneList.findUnique({
      where: { token: 'poll-token' },
    })
    expect(afterFirstPoll?.peerlyListId).toBe(555)

    // A second poll (e.g. the client retrying) must not re-write or clobber
    // the already-stamped id.
    const second = await service.client.get(
      '/v1/p2p/phone-list/poll-token/status',
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(second.status).toBe(200)

    const afterSecondPoll = await service.prisma.peerlyPhoneList.findUnique({
      where: { token: 'poll-token' },
    })
    expect(afterSecondPoll?.peerlyListId).toBe(555)
    expect(afterSecondPoll?.createdAt).toEqual(afterFirstPoll?.createdAt)
  })
})
