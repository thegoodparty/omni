import { HttpService } from '@nestjs/axios'
import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { FeaturesService } from '@/features/services/features.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { of } from 'rxjs'
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
const DISTRICT_ID = 'district-p2p-phone-list'

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
  id: 'p-no-response',
  firstName: 'Jane',
  lastName: 'Doe',
  cellPhone: '5551234567',
  address: { city: 'Springfield', state: 'CA', zip: '90210' },
  ...overrides,
})

const stubPeopleApi = (people: Record<string, unknown>[]) =>
  vi.spyOn(service.app.get(HttpService), 'post').mockImplementation(((
    url: string,
  ) =>
    url.includes('/v1/people')
      ? of({
          data: {
            people,
            pagination: { totalResults: people.length, hasNextPage: false },
          },
        })
      : of({ data: {} })) as never)

const stubPeerlyUpload = (token = 'peerly-upload-token') =>
  vi
    .spyOn(service.app.get(PeerlyPhoneListService), 'uploadPhoneList')
    .mockResolvedValue(token)

const stubVoterDataFlag = (enabled = true) =>
  vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(enabled)

describe('POST /v1/p2p/phone-list (ENG-10728 contacts-pipeline capture)', () => {
  beforeEach(() => {
    stubDistrict()
    stubVoterDataFlag()
  })

  it('resolves activityConditions through the contacts pipeline and captures exactly the CSV rows', async () => {
    const campaign = await seedWinCampaign()
    const outreach = await seedCompletedOutreach(campaign.id, OutreachType.text)
    const texts = service.app.get(ContactInteractionTextService)
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: 'p-responded',
      occurredAt: new Date(),
      outreachId: outreach.id,
      respondedAt: new Date(),
    })
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: 'p-no-response',
      occurredAt: new Date(),
      outreachId: outreach.id,
    })

    const post = stubPeopleApi([
      personPayload(),
      // null zip: unusable for Peerly geo-targeting, must be skipped from
      // both the CSV and the capture rows
      personPayload({
        id: 'p-no-zip',
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

    // The activity condition genuinely reached people-api — only the
    // non-responder's id, intersected with hasCellPhone, is requested. This
    // is the exact defect the legacy voter-DB path had (it ignored
    // activityConditions entirely).
    const peopleCall = post.mock.calls.find((call) =>
      String(call[0]).includes('/v1/people'),
    )
    expect(peopleCall?.[1]).toMatchObject({
      filters: { id: { in: ['p-no-response'] }, hasCellPhone: true },
    })

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
        personId: 'p-no-response',
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
    // The persisted segment's criteria drove resolution: the people-api
    // request carries the saved partyDemocrat filter, not just the (empty)
    // inline fields — plus the channel-forced hasCellPhone.
    const peopleCall = post.mock.calls.find((call) =>
      String(call[0]).includes('/v1/people'),
    )
    expect(peopleCall?.[1]).toMatchObject({
      filters: { politicalParty: { eq: 'Democratic' }, hasCellPhone: true },
    })
    expect(
      await service.prisma.peerlyPhoneList.findUnique({
        where: { token: 'peerly-upload-token' },
      }),
    ).toMatchObject({ voterFileFilterId: savedFilter.id })
  })

  it('403s when the win-voter-data flag is off for the user', async () => {
    await seedWinCampaign()
    stubVoterDataFlag(false)
    const post = stubPeopleApi([personPayload()])
    stubPeerlyUpload()

    const result = await service.client.post(
      '/v1/p2p/phone-list',
      { name: 'Gated list' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(403)
    expect(post).not.toHaveBeenCalled()
    expect(await service.prisma.peerlyPhoneList.count()).toBe(0)
  })

  it('400s when no contact is uploadable instead of sending an empty CSV', async () => {
    await seedWinCampaign()
    stubPeopleApi([
      personPayload({
        id: 'p-no-zip',
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
    expect(first.data).toEqual({ phoneListId: 555, leadsLoaded: 10 })

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
