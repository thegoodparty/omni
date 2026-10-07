import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { QueueType } from '@/queue/queue.types'
import { subMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OfficeLevel,
  OutreachStatus,
  OutreachType,
} from '../../../generated/prisma'
import { P2pPhoneListUploadService } from './p2pPhoneListUpload.service'
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
    expect(result.data).toMatchObject({ token: 'peerly-upload-token' })
    expect(typeof result.data.buildId).toBe('string')

    // The activity condition genuinely reached the people-db query — only
    // the non-responder's id, intersected with hasCellPhone, is requested.
    // This is the exact defect the retired legacy export path had (it
    // ignored activityConditions entirely).
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
    // the upload token (and by buildId — the row recordUpload UPDATED, not
    // a second one), one recipient row for the one CSV line.
    const capturedList = await service.prisma.peerlyPhoneList.findUnique({
      where: { token: 'peerly-upload-token' },
    })
    expect(capturedList).toMatchObject({
      id: result.data.buildId,
      organizationSlug: WIN_SLUG,
      campaignId: campaign.id,
      peerlyListId: null,
      buildStatus: 'processing',
    })
    expect(await service.prisma.peerlyPhoneList.count()).toBe(1)
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

  it('marks the build row failed (not a capture row left in queued/building) when the Peerly upload fails', async () => {
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
    expect(await service.prisma.peerlyPhoneList.count()).toBe(1)
    const build = await service.prisma.peerlyPhoneList.findFirst({
      where: { campaignId: campaign.id },
    })
    expect(build).toMatchObject({
      buildStatus: 'failed',
      token: null,
      // The same sanitized message the HTTP response carries — never the
      // raw vendor/internal error text ("Peerly API ERROR"), which this
      // endpoint has never put in a client-facing response.
      buildError: 'Failed to upload phone list to Peerly platform',
    })
    expect(await service.prisma.peerlyPhoneListRecipient.count()).toBe(0)
    // Sanity: the campaign row itself is unaffected by the failed upload.
    expect(
      await service.prisma.campaign.findUnique({ where: { id: campaign.id } }),
    ).not.toBeNull()
  })

  it('still blocks a non-pro Win campaign (access check inherited from the contacts pipeline)', async () => {
    const campaign = await seedWinCampaign(false)
    const post = stubPeopleApi([personPayload()])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Blocked list' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBeGreaterThanOrEqual(400)
    expect(post).not.toHaveBeenCalled()
    // The Pro check throws from inside the build (ContactsService, via
    // resolveFilterAudience) — the row created on accept is marked failed
    // rather than left queued, same as any other build failure.
    expect(await service.prisma.peerlyPhoneList.count()).toBe(1)
    const build = await service.prisma.peerlyPhoneList.findFirst({
      where: { campaignId: campaign.id },
    })
    expect(build).toMatchObject({ buildStatus: 'failed', token: null })
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
    // The row created on accept is marked failed (empty audience is one of
    // the build-failure paths), not left behind at queued.
    expect(await service.prisma.peerlyPhoneList.count()).toBe(1)
    expect(await service.prisma.peerlyPhoneList.findFirst()).toMatchObject({
      buildStatus: 'failed',
      token: null,
    })
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
    // querying people-db with an illegal zero-length `in`. The row created
    // on accept is marked failed rather than left behind queued.
    expect(result.status).toBe(400)
    expect(post).not.toHaveBeenCalled()
    expect(await service.prisma.peerlyPhoneList.count()).toBe(1)
    expect(await service.prisma.peerlyPhoneList.findFirst()).toMatchObject({
      buildStatus: 'failed',
      token: null,
    })
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
    const SHARED_PHONE = '5553334444'
    const SHARED_PERSON_PAGE_1 = '00000000-0000-0000-0000-000000000011'
    const SHARED_PERSON_PAGE_2 = '00000000-0000-0000-0000-000000000012'
    // The loop now pages until a SHORT page (people.length < SEGMENT_PAGE_SIZE),
    // not on pagination.hasNextPage — so a full first page (1000 rows) is what
    // makes it fetch a second page at all. The shared phone appears once per
    // page, so the dedup Set must survive the page boundary.
    const firstPage = [
      personPayload({ id: SHARED_PERSON_PAGE_1, cellPhone: SHARED_PHONE }),
      ...Array.from({ length: 999 }, (_, i) =>
        personPayload({
          id: `00000000-0000-0000-0001-${String(i + 1).padStart(12, '0')}`,
          cellPhone: `55500${String(i + 1).padStart(5, '0')}`,
        }),
      ),
    ]
    const secondPage = [
      personPayload({ id: SHARED_PERSON_PAGE_2, cellPhone: SHARED_PHONE }),
    ]
    stubPeopleApiPaginated([firstPage, secondPage])
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
    // The page-2 occurrence of the shared phone is dropped; the first-seen
    // occurrence on page 1 is kept.
    expect(capturedList?.excludedDuplicatePhoneCount).toBe(1)
    const recipients = await service.prisma.peerlyPhoneListRecipient.findMany({
      where: { peerlyPhoneListId: capturedList?.id },
    })
    // Every unique phone on the full first page is captured; only the page-2
    // duplicate is excluded.
    expect(recipients).toHaveLength(firstPage.length)
    expect(recipients).toContainEqual(
      expect.objectContaining({
        personId: SHARED_PERSON_PAGE_1,
        phone: SHARED_PHONE,
      }),
    )
    expect(recipients.some((r) => r.personId === SHARED_PERSON_PAGE_2)).toBe(
      false,
    )
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

describe('POST /v1/p2p/phone-list (INC-101 resolution deadline)', () => {
  beforeEach(() => {
    stubDistrict()
  })

  // Date.now is stubbed below and `clearMocks` only clears calls, so put the
  // real clock back before anything else in this file runs. Restoring this one
  // spy rather than all of them: `useTestService` stubs auth with spies of its
  // own, and vi.restoreAllMocks() takes those out too (401s for the rest of
  // the file).
  let restoreClock: (() => void) | undefined
  afterEach(() => {
    restoreClock?.()
    restoreClock = undefined
  })

  it('400s a filter it cannot resolve in time instead of uploading after the gateway has hung up', async () => {
    await seedWinCampaign()
    const upload = stubPeerlyUpload()

    // The production shape: 82,000 matched rows — UNDER the 100,000 cap, so
    // nothing here used to refuse it — at ~1.5s per page of 1000, which is
    // ~123s against a gateway that hangs up at ~120s. In prod that request
    // died with no status at 120,038ms and the handler went on to upload the
    // list to Peerly 45.9s later, so the official saw a failure for a list
    // that exists. The pages advance the clock; a real one would mean a
    // two-minute test.
    let now = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    restoreClock = () => clock.mockRestore()
    let pageNumber = 0
    const findPeople = vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockImplementation(((dto: { page: number }) => {
        pageNumber += 1
        now += pageNumber === 1 ? 3000 : 1500
        return Promise.resolve({
          people: Array.from({ length: 1000 }, (_, i) =>
            personPayload({
              id: `00000000-0000-0000-${String(dto.page).padStart(4, '0')}-${String(i).padStart(12, '0')}`,
              cellPhone: `555${String(dto.page).padStart(3, '0')}${String(i).padStart(4, '0')}`,
            }),
          ),
          pagination: { totalResults: 82_000, hasNextPage: true },
        })
      }) as never)

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Whole county' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(400)
    expect(result.data.message).toMatch(/too many to build a phone list/)
    // Two pages, not 82: the official is told in about 4.5s.
    expect(findPeople).toHaveBeenCalledTimes(2)
    // The harm this closes. Nothing reached Peerly, so there is no list the
    // official was never handed a token for — the row created on accept is
    // marked failed instead of acquiring a token.
    expect(upload).not.toHaveBeenCalled()
    expect(await service.prisma.peerlyPhoneList.count()).toBe(1)
    expect(await service.prisma.peerlyPhoneList.findFirst()).toMatchObject({
      buildStatus: 'failed',
      token: null,
    })
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
      // leads_supplied === leads_loaded: a fully-loaded (small) list, which
      // stabilizes on the very first ACTIVE read — the stable-leads_loaded
      // guard's fast path.
    ).mockResolvedValue({ leads_loaded: 10, leads_supplied: 10 } as never)

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

describe('POST /v1/p2p/phone-list (build-status row lifecycle)', () => {
  beforeEach(() => {
    stubDistrict()
  })

  it('creates the row queued, then recordUpload advances THE SAME row to processing — never a second row', async () => {
    await seedWinCampaign()
    stubPeopleApi([personPayload()])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Build status lifecycle' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)
    const { buildId } = result.data as { buildId: string }
    expect(typeof buildId).toBe('string')

    const row = await service.prisma.peerlyPhoneList.findUnique({
      where: { id: buildId },
    })
    expect(row).toMatchObject({
      token: 'peerly-upload-token',
      buildStatus: 'processing',
    })
    // One row total — recordUpload UPDATED the pre-created row rather than
    // inserting a second one.
    expect(await service.prisma.peerlyPhoneList.count()).toBe(1)
  })
})

describe('GET /v1/p2p/phone-list/build/:buildId/status (additive build-status route)', () => {
  it('returns 202 for a queued build with no token yet', async () => {
    const campaign = await seedWinCampaign()
    const build = await service.prisma.peerlyPhoneList.create({
      data: { organizationSlug: WIN_SLUG, campaignId: campaign.id },
    })

    const result = await service.client.get(
      `/v1/p2p/phone-list/build/${build.id}/status`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(202)
  })

  it('returns 200 ready with phoneListId/leadsLoaded and stamps peerlyListId once reachable through the stored token', async () => {
    const campaign = await seedWinCampaign()
    const build = await service.prisma.peerlyPhoneList.create({
      data: {
        organizationSlug: WIN_SLUG,
        campaignId: campaign.id,
        token: 'build-status-token',
        buildStatus: 'processing',
        excludedOptedOutCount: 3,
        excludedDuplicatePhoneCount: 2,
      },
    })
    vi.spyOn(
      service.app.get(PeerlyPhoneListService),
      'checkPhoneListStatus',
    ).mockResolvedValue({
      Data: { list_state: 'ACTIVE', list_id: 777 },
    } as never)
    vi.spyOn(
      service.app.get(PeerlyPhoneListService),
      'getPhoneListDetails',
      // Fully loaded (leads_supplied === leads_loaded) — stabilizes on the
      // first ACTIVE read, same fast path as the token-route test above.
    ).mockResolvedValue({ leads_loaded: 42, leads_supplied: 42 } as never)

    const result = await service.client.get(
      `/v1/p2p/phone-list/build/${build.id}/status`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(200)
    expect(result.data).toEqual({
      phoneListId: 777,
      leadsLoaded: 42,
      excludedOptedOutCount: 3,
      excludedDuplicatePhoneCount: 2,
    })

    const stamped = await service.prisma.peerlyPhoneList.findUnique({
      where: { id: build.id },
    })
    expect(stamped).toMatchObject({ peerlyListId: 777, buildStatus: 'ready' })
  })

  it('does not stamp ready while leads_loaded keeps climbing, and stamps once it reads the same value twice', async () => {
    const campaign = await seedWinCampaign()
    const build = await service.prisma.peerlyPhoneList.create({
      data: {
        organizationSlug: WIN_SLUG,
        campaignId: campaign.id,
        token: 'climbing-token',
        buildStatus: 'processing',
      },
    })
    vi.spyOn(
      service.app.get(PeerlyPhoneListService),
      'checkPhoneListStatus',
    ).mockResolvedValue({
      Data: { list_state: 'ACTIVE', list_id: 888 },
    } as never)
    const getDetails = vi.spyOn(
      service.app.get(PeerlyPhoneListService),
      'getPhoneListDetails',
    )

    const poll = () =>
      service.client.get(`/v1/p2p/phone-list/build/${build.id}/status`, {
        headers: { [ORG_SLUG_HEADER]: WIN_SLUG },
      })

    // Never equal to leads_supplied (500), so the only way to ready is two
    // consecutive equal reads — never the leads_supplied fast path.
    getDetails.mockResolvedValueOnce({
      leads_loaded: 100,
      leads_supplied: 500,
    } as never)
    const first = await poll()
    expect(first.status).toBe(202)
    expect(
      await service.prisma.peerlyPhoneList.findUnique({
        where: { id: build.id },
      }),
    ).toMatchObject({ peerlyListId: null, buildStatus: 'processing' })

    // Still climbing — the stored reading updates, but it's still not ready.
    getDetails.mockResolvedValueOnce({
      leads_loaded: 300,
      leads_supplied: 500,
    } as never)
    const second = await poll()
    expect(second.status).toBe(202)
    expect(
      await service.prisma.peerlyPhoneList.findUnique({
        where: { id: build.id },
      }),
    ).toMatchObject({ peerlyListId: null, buildStatus: 'processing' })

    // Same value as the previous read — stable, so this poll stamps ready.
    getDetails.mockResolvedValueOnce({
      leads_loaded: 300,
      leads_supplied: 500,
    } as never)
    const third = await poll()
    expect(third.status).toBe(200)
    expect(third.data).toMatchObject({ phoneListId: 888, leadsLoaded: 300 })
    expect(
      await service.prisma.peerlyPhoneList.findUnique({
        where: { id: build.id },
      }),
    ).toMatchObject({ peerlyListId: 888, buildStatus: 'ready' })
  })

  it('returns 200 failed with the stored buildError, without calling Peerly', async () => {
    const campaign = await seedWinCampaign()
    const checkStatus = vi.spyOn(
      service.app.get(PeerlyPhoneListService),
      'checkPhoneListStatus',
    )
    const build = await service.prisma.peerlyPhoneList.create({
      data: {
        organizationSlug: WIN_SLUG,
        campaignId: campaign.id,
        buildStatus: 'failed',
        buildError: 'No contacts matched the filter',
      },
    })

    const result = await service.client.get(
      `/v1/p2p/phone-list/build/${build.id}/status`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(200)
    expect(result.data).toEqual({
      buildStatus: 'failed',
      buildError: 'No contacts matched the filter',
    })
    expect(checkStatus).not.toHaveBeenCalled()
  })

  it('404s a build the campaign does not own', async () => {
    await seedWinCampaign()
    await service.prisma.organization.create({
      data: { slug: 'other-org-build-status', ownerId: service.user.id },
    })
    const otherCampaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'other-org-build-status-campaign',
        organizationSlug: 'other-org-build-status',
      },
    })
    const foreignBuild = await service.prisma.peerlyPhoneList.create({
      data: {
        organizationSlug: 'other-org-build-status',
        campaignId: otherCampaign.id,
      },
    })

    const result = await service.client.get(
      `/v1/p2p/phone-list/build/${foreignBuild.id}/status`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(404)
  })

  it('still 404s the old token route for the same row at its pre-token (queued) state, unaffected by the new route', async () => {
    const campaign = await seedWinCampaign()
    await service.prisma.peerlyPhoneList.create({
      data: { organizationSlug: WIN_SLUG, campaignId: campaign.id },
    })

    // No token yet, so the token route (keyed on token, not id) can't find it
    // — this is the exact gap the new buildId route exists to close, and
    // confirms the old route's own lookup is untouched by this slice.
    const result = await service.client.get(
      '/v1/p2p/phone-list/no-such-token/status',
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(404)
  })
})

describe('P2P phone-list async build (Voter Outreach 2.0 S3b, kill-switch gated)', () => {
  beforeEach(() => {
    stubDistrict()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const ageBuildRow = (buildId: string, minutes: number) =>
    // @updatedAt is client-managed (Prisma always overwrites an explicit
    // value with now()), so a stale claim can only be simulated with a raw
    // write to the underlying column — same trick as
    // outreachRobocallStaging.test.ts's ageStagingRow.
    service.prisma.$executeRaw`
      UPDATE peerly_phone_list
      SET updated_at = ${subMinutes(new Date(), minutes)}
      WHERE id = ${buildId}
    `

  describe('kill switch', () => {
    it('OFF (default/unset): unchanged synchronous S2 behavior — builds and uploads in-request', async () => {
      await seedWinCampaign()
      stubPeopleApi([personPayload()])
      const upload = stubPeerlyUpload()
      const enqueue = vi
        .spyOn(service.app.get(QueueProducerService), 'sendMessage')
        .mockResolvedValue(undefined)

      const result = await service.client.post(
        '/v1/p2p/phone-list',
        { name: 'Sync default' },
        { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data).toMatchObject({ token: 'peerly-upload-token' })
      expect(upload).toHaveBeenCalledTimes(1)
      expect(enqueue).not.toHaveBeenCalled()
      expect(
        await service.prisma.peerlyPhoneList.findFirst({
          where: { token: 'peerly-upload-token' },
        }),
      ).toMatchObject({ buildStatus: 'processing' })
    })

    it('ON: creates the queued row, enqueues after it commits, and returns {buildId, token: null} without building in-request', async () => {
      vi.stubEnv('P2P_PHONE_LIST_ASYNC_BUILD', 'true')
      await seedWinCampaign()
      const upload = stubPeerlyUpload()
      const enqueue = vi
        .spyOn(service.app.get(QueueProducerService), 'sendMessage')
        .mockResolvedValue(undefined)

      const result = await service.client.post(
        '/v1/p2p/phone-list',
        { name: 'Async accept' },
        { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data).toEqual({
        token: null,
        buildId: expect.any(String),
      })
      expect(upload).not.toHaveBeenCalled()

      const { buildId } = result.data as { buildId: string }
      // The row the enqueued message points at already exists (and already
      // carries the snapshot the handler needs) by the time sendMessage was
      // called — proof the enqueue happened after the row committed, not
      // before.
      const row = await service.prisma.peerlyPhoneList.findUnique({
        where: { id: buildId },
      })
      expect(row).toMatchObject({ buildStatus: 'queued', token: null })
      expect(row?.requestSnapshot).toMatchObject({ name: 'Async accept' })

      expect(enqueue).toHaveBeenCalledTimes(1)
      const [message, group, options] = enqueue.mock.calls[0]!
      expect(message).toEqual({
        type: QueueType.P2P_PHONE_LIST_BUILD,
        data: { buildId },
      })
      expect(group).toContain(buildId)
      expect(options).toMatchObject({ throwOnError: true })
    })
  })

  describe('handleQueuedBuild', () => {
    const createQueuedRow = async (
      campaignId: number,
      snapshot: Record<string, unknown> = { name: 'Queued build' },
      organizationSlug = WIN_SLUG,
    ) =>
      service.prisma.peerlyPhoneList.create({
        data: {
          organizationSlug,
          campaignId,
          requestSnapshot: snapshot,
        },
      })

    it('happy path: queued -> processing, with a token, via the real build+upload', async () => {
      const campaign = await seedWinCampaign()
      stubPeopleApi([personPayload()])
      const upload = stubPeerlyUpload()
      const build = await createQueuedRow(campaign.id)

      const acked = await service.app
        .get(P2pPhoneListUploadService)
        .handleQueuedBuild(build.id)

      expect(acked).toBe(true)
      expect(upload).toHaveBeenCalledTimes(1)
      const row = await service.prisma.peerlyPhoneList.findUnique({
        where: { id: build.id },
      })
      expect(row).toMatchObject({
        buildStatus: 'processing',
        token: 'peerly-upload-token',
      })
      expect(
        await service.prisma.peerlyPhoneListRecipient.count({
          where: { peerlyPhoneListId: build.id },
        }),
      ).toBe(1)
    })

    it('concurrent double delivery builds and uploads to Peerly exactly once (claim CAS)', async () => {
      const campaign = await seedWinCampaign()
      stubPeopleApi([personPayload()])
      const upload = stubPeerlyUpload()
      const build = await createQueuedRow(campaign.id)

      const handler = service.app.get(P2pPhoneListUploadService)
      const [firstAck, secondAck] = await Promise.all([
        handler.handleQueuedBuild(build.id),
        handler.handleQueuedBuild(build.id),
      ])

      // Both deliveries ack — the loser's claim misses (count 0) rather than
      // erroring, which is the idempotent-no-op contract.
      expect(firstAck).toBe(true)
      expect(secondAck).toBe(true)
      expect(upload).toHaveBeenCalledTimes(1)
      expect(
        await service.prisma.peerlyPhoneListRecipient.count({
          where: { peerlyPhoneListId: build.id },
        }),
      ).toBe(1)
    })

    it('a redelivery that finds a token already stamped skips the Peerly upload entirely', async () => {
      const campaign = await seedWinCampaign()
      stubPeopleApi([personPayload()])
      const upload = stubPeerlyUpload('already-stamped-token')
      // Simulates the crash window: a prior attempt's Peerly upload
      // succeeded and stampBuildToken wrote the token, but the process died
      // before recordUpload wrote the recipients — the reaper reset this row
      // back to `queued` without touching the token.
      const build = await service.prisma.peerlyPhoneList.create({
        data: {
          organizationSlug: WIN_SLUG,
          campaignId: campaign.id,
          token: 'already-stamped-token',
          requestSnapshot: { name: 'Resumed build' },
        },
      })

      const acked = await service.app
        .get(P2pPhoneListUploadService)
        .handleQueuedBuild(build.id)

      expect(acked).toBe(true)
      expect(upload).not.toHaveBeenCalled()
      const row = await service.prisma.peerlyPhoneList.findUnique({
        where: { id: build.id },
      })
      expect(row).toMatchObject({
        buildStatus: 'processing',
        token: 'already-stamped-token',
      })
      expect(
        await service.prisma.peerlyPhoneListRecipient.count({
          where: { peerlyPhoneListId: build.id },
        }),
      ).toBe(1)
    })

    it('a permanent failure (no TCR identity) marks the row failed and acks', async () => {
      const campaign = await service.prisma.organization
        .create({
          data: { slug: 'no-tcr-async', ownerId: service.user.id },
        })
        .then(() =>
          service.prisma.campaign.create({
            data: {
              userId: service.user.id,
              slug: 'no-tcr-async-campaign',
              organizationSlug: 'no-tcr-async',
            },
          }),
        )
      const build = await createQueuedRow(
        campaign.id,
        { name: 'Queued build' },
        'no-tcr-async',
      )

      const acked = await service.app
        .get(P2pPhoneListUploadService)
        .handleQueuedBuild(build.id)

      expect(acked).toBe(true)
      expect(
        await service.prisma.peerlyPhoneList.findUnique({
          where: { id: build.id },
        }),
      ).toMatchObject({
        buildStatus: 'failed',
        buildError: 'TCR compliance record does not have a Peerly identity ID',
      })
    })

    it('a transient failure (people-db) throws so SQS redelivers, leaving the row building', async () => {
      const campaign = await seedWinCampaign()
      vi.spyOn(
        service.app.get(VoterQueryService),
        'findPeople',
      ).mockRejectedValue(new Error('people-db unavailable'))
      const build = await createQueuedRow(campaign.id)

      await expect(
        service.app.get(P2pPhoneListUploadService).handleQueuedBuild(build.id),
      ).rejects.toThrow('people-db unavailable')

      const row = await service.prisma.peerlyPhoneList.findUnique({
        where: { id: build.id },
      })
      // Left `building`, not `failed` — a transient fault parks nothing;
      // the stale-building reaper (or SQS redelivery once the row is reset)
      // is what retries it.
      expect(row).toMatchObject({ buildStatus: 'building', buildAttempts: 1 })
    })
  })

  describe('stale-building reclaim', () => {
    it('reclaims a stale `building` row back to `queued` and re-enqueues it', async () => {
      const campaign = await seedWinCampaign()
      const build = await service.prisma.peerlyPhoneList.create({
        data: {
          organizationSlug: WIN_SLUG,
          campaignId: campaign.id,
          buildStatus: 'building',
          buildAttempts: 1,
          requestSnapshot: { name: 'Stuck build' },
        },
      })
      await ageBuildRow(build.id, 30)
      const enqueue = vi
        .spyOn(service.app.get(QueueProducerService), 'sendMessage')
        .mockResolvedValue(undefined)

      await service.app.get(P2pPhoneListUploadService).sweepStaleBuilding()

      expect(
        await service.prisma.peerlyPhoneList.findUnique({
          where: { id: build.id },
        }),
      ).toMatchObject({ buildStatus: 'queued' })
      expect(enqueue).toHaveBeenCalledTimes(1)
      const [message] = enqueue.mock.calls[0]!
      expect(message).toEqual({
        type: QueueType.P2P_PHONE_LIST_BUILD,
        data: { buildId: build.id },
      })
    })

    it('does not touch a `building` row that is still within the stale window', async () => {
      const campaign = await seedWinCampaign()
      const build = await service.prisma.peerlyPhoneList.create({
        data: {
          organizationSlug: WIN_SLUG,
          campaignId: campaign.id,
          buildStatus: 'building',
          requestSnapshot: { name: 'Healthy in-flight build' },
        },
      })
      const enqueue = vi
        .spyOn(service.app.get(QueueProducerService), 'sendMessage')
        .mockResolvedValue(undefined)

      await service.app.get(P2pPhoneListUploadService).sweepStaleBuilding()

      expect(
        await service.prisma.peerlyPhoneList.findUnique({
          where: { id: build.id },
        }),
      ).toMatchObject({ buildStatus: 'building' })
      expect(enqueue).not.toHaveBeenCalled()
    })

    it('fails a stale row permanently once it has exceeded its retry budget', async () => {
      const campaign = await seedWinCampaign()
      const build = await service.prisma.peerlyPhoneList.create({
        data: {
          organizationSlug: WIN_SLUG,
          campaignId: campaign.id,
          buildStatus: 'building',
          buildAttempts: 3,
          requestSnapshot: { name: 'Exhausted build' },
        },
      })
      await ageBuildRow(build.id, 30)
      const enqueue = vi
        .spyOn(service.app.get(QueueProducerService), 'sendMessage')
        .mockResolvedValue(undefined)

      await service.app.get(P2pPhoneListUploadService).sweepStaleBuilding()

      expect(
        await service.prisma.peerlyPhoneList.findUnique({
          where: { id: build.id },
        }),
      ).toMatchObject({ buildStatus: 'failed' })
      expect(enqueue).not.toHaveBeenCalled()
    })
  })
})
