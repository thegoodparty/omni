import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { FeaturesService } from '@/features/services/features.service'
import { convertVoterFileFilterToFilters } from '@/contacts/utils/voterFileFilter.utils'
import { ContactInteractionDoorKnockService } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from '@/contactInteraction/services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { VoterDownloadService } from '@/peopleDb/services/voterDownload.service'
import type { FilterData } from '@/peopleDb/schemas/filters.schema'
import {
  DoorKnockOutcome,
  OutreachStatus,
  OutreachType,
  SupportAnswer,
  VoterFileFilter,
} from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ReconstructedFilterValue =
  | { eq: string | number }
  | { in: string[] | number[] }
  | { notIn: string[] }
  | { is: string }

// Reconstructs the pre-transform wire shape (e.g. `{ id: { in: [...] } }`)
// from the transformed FilterData a local people-db service call now
// receives, so assertions read the same as they did against the old
// outgoing people-api request body.
const reconstructFilters = (
  filters: FilterData,
): Record<string, ReconstructedFilterValue> => {
  const result: Record<string, ReconstructedFilterValue> = {}
  for (const key of filters.filters) {
    const op = filters.filterOperators[key]
    if (!op) continue
    if (op.operator === 'eq' && op.value !== undefined) {
      result[key] = { eq: op.value }
    } else if (op.operator === 'in' && op.values) {
      result[key] = { in: op.values }
    } else if (op.operator === 'notIn' && op.values) {
      result[key] = { notIn: op.values as string[] }
    } else if (op.operator === 'is' && op.value !== undefined) {
      result[key] = { is: String(op.value) }
    }
  }
  return result
}

const service = useTestService()

const WIN_SLUG = 'campaign-win-segments'
const ORG_SLUG_HEADER = 'X-Organization-Slug'
// districtId and the resolved activity-condition/support-status id set both
// now flow through the real people-db Zod DTOs (ListPeopleDTO etc.), which
// require GUID-shaped strings — unlike the legacy people-api HTTP path,
// which just serialized these into a JSON body with no format validation.
const DISTRICT_ID = '10000000-0000-0000-0000-000000000000'
const PERSON_NO_RESPONSE = '00000000-0000-0000-0000-000000000001'
const PERSON_RESPONDED = '00000000-0000-0000-0000-000000000002'
const PERSON_BOTH = '00000000-0000-0000-0000-000000000003'
const PERSON_TEXT_ONLY = '00000000-0000-0000-0000-000000000004'
const PERSON_SUPPORTER = '00000000-0000-0000-0000-000000000005'
const PERSON_NON_SUPPORTER = '00000000-0000-0000-0000-000000000006'

const seedWinCampaign = async (isPro = true) => {
  await service.prisma.organization.create({
    data: {
      slug: WIN_SLUG,
      ownerId: service.user.id,
      overrideDistrictId: DISTRICT_ID,
    },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${WIN_SLUG}-campaign`,
      organizationSlug: WIN_SLUG,
      isPro,
    },
  })
}

const seedCompletedOutreach = (
  campaignId: number,
  organizationSlug: string | null,
  outreachType: OutreachType,
) =>
  service.prisma.outreach.create({
    data: {
      campaignId,
      organizationSlug,
      outreachType,
      status: OutreachStatus.completed,
    },
  })

// A completed nativePhoneBanking envelope with a real linked
// PhoneBankingList — the shape `phoneBankingList.service.ts` actually
// writes at list creation (outreachType nativePhoneBanking,
// phoneBankingListId set), which a phoneBanking activity condition must
// accept via the channel equivalence.
const seedCompletedNativePhoneBankingOutreach = async (
  campaignId: number,
  organizationSlug: string,
) => {
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug, name: 'PB seed audience' },
  })
  const list = await service.prisma.phoneBankingList.create({
    data: {
      organizationSlug,
      voterFileFilterId: filter.id,
      name: 'PB seed list',
      script: 'Hi, this is a volunteer calling about the election.',
      sheetCount: 1,
      purpose: 'introduce',
    },
  })
  return service.prisma.outreach.create({
    data: {
      campaignId,
      organizationSlug,
      outreachType: OutreachType.nativePhoneBanking,
      status: OutreachStatus.completed,
      phoneBankingListId: list.id,
    },
  })
}

// A Win segment that names a political party plus a couple of other criteria.
const partySegmentBody = {
  name: 'Independent women',
  partyIndependent: true,
  genderFemale: true,
  audienceSuperVoters: true,
}

describe('voter-file segment CRUD for a campaign org', () => {
  it('creates, gets, lists, updates, and deletes a saved segment', async () => {
    await seedWinCampaign()

    const created = await service.client.post(
      '/v1/voters/voter-file/filter',
      partySegmentBody,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(created.status).toBe(201)
    const id = created.data.id as number
    expect(id).toEqual(expect.any(Number))

    const persisted = await service.prisma.voterFileFilter.findUnique({
      where: { id },
    })
    expect(persisted).toMatchObject({
      organizationSlug: WIN_SLUG,
      name: 'Independent women',
      partyIndependent: true,
      genderFemale: true,
      audienceSuperVoters: true,
    })

    const fetched = await service.client.get(
      `/v1/voters/voter-file/filter/${id}`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(fetched.status).toBe(200)
    expect(fetched.data.id).toBe(id)

    const listed = await service.client.get('/v1/voters/voter-file/filters', {
      headers: { [ORG_SLUG_HEADER]: WIN_SLUG },
    })
    expect(listed.status).toBe(200)
    expect(listed.data).toHaveLength(1)
    expect(listed.data[0].id).toBe(id)

    const updated = await service.client.put(
      `/v1/voters/voter-file/filter/${id}`,
      { name: 'Independent women (renamed)', partyDemocrat: true },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(updated.status).toBe(200)
    const afterUpdate = await service.prisma.voterFileFilter.findUnique({
      where: { id },
    })
    expect(afterUpdate?.name).toBe('Independent women (renamed)')
    expect(afterUpdate?.partyDemocrat).toBe(true)

    const deleted = await service.client.delete(
      `/v1/voters/voter-file/filter/${id}`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(deleted.status).toBe(204)
    expect(
      await service.prisma.voterFileFilter.findUnique({ where: { id } }),
    ).toBeNull()
  })

  it('does not delete a filter owned by another org', async () => {
    await seedWinCampaign()
    const OTHER_SLUG = 'campaign-other-org'
    await service.prisma.organization.create({
      data: { slug: OTHER_SLUG, ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${OTHER_SLUG}-campaign`,
        organizationSlug: OTHER_SLUG,
        isPro: true,
      },
    })

    const otherFilter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: OTHER_SLUG, ...partySegmentBody },
    })

    const attempt = await service.client.delete(
      `/v1/voters/voter-file/filter/${otherFilter.id}`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(attempt.status).toBe(404)
    expect(
      await service.prisma.voterFileFilter.findUnique({
        where: { id: otherFilter.id },
      }),
    ).not.toBeNull()
  })

  it('rejects segment creation for a non-pro Win campaign', async () => {
    await seedWinCampaign(false)

    const created = await service.client.post(
      '/v1/voters/voter-file/filter',
      partySegmentBody,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(created.status).toBe(400)
    expect(await service.prisma.voterFileFilter.count()).toBe(0)
  })
})

describe('activity conditions and supportStatus on a segment', () => {
  it('persists 2 conditions + supportStatus, then replaces with 1 on update', async () => {
    const campaign = await seedWinCampaign()
    const completedText = await seedCompletedOutreach(
      campaign.id,
      WIN_SLUG,
      OutreachType.text,
    )
    const completedRobocall = await seedCompletedOutreach(
      campaign.id,
      WIN_SLUG,
      OutreachType.robocall,
    )

    const created = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Responders',
        supportStatus: ['supporter', 'unknown'],
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: completedText.id,
            actions: ['responded'],
          },
          {
            outreachType: 'doorKnocking',
            actions: ['support_yes', 'answered'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(created.status).toBe(201)
    expect(created.data.supportStatus).toEqual(['supporter', 'unknown'])
    expect(created.data.activityConditions).toHaveLength(2)
    const id = created.data.id as number

    expect(
      await service.prisma.voterFileFilterActivityCondition.count({
        where: { voterFileFilterId: id },
      }),
    ).toBe(2)

    const fetched = await service.client.get(
      `/v1/voters/voter-file/filter/${id}`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(fetched.data.activityConditions).toHaveLength(2)

    const updated = await service.client.put(
      `/v1/voters/voter-file/filter/${id}`,
      {
        supportStatus: ['non_supporter'],
        activityConditions: [
          {
            outreachType: 'robocall',
            outreachId: completedRobocall.id,
            actions: ['answered'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(updated.status).toBe(200)
    expect(updated.data.activityConditions).toHaveLength(1)
    expect(updated.data.supportStatus).toEqual(['non_supporter'])

    const afterUpdate =
      await service.prisma.voterFileFilterActivityCondition.findMany({
        where: { voterFileFilterId: id },
      })
    expect(afterUpdate).toHaveLength(1)
    expect(afterUpdate[0]?.outreachType).toBe(OutreachType.robocall)
    expect(afterUpdate[0]?.outreachId).toBe(completedRobocall.id)
  })

  it('rejects an action invalid for its channel', async () => {
    await seedWinCampaign()

    const result = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Bad action',
        activityConditions: [
          { outreachType: 'text', actions: ['voicemail_left'] },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(400)
    expect(await service.prisma.voterFileFilter.count()).toBe(0)
  })

  it('rejects a channel with no interaction model', async () => {
    await seedWinCampaign()

    const result = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Bad channel',
        activityConditions: [{ outreachType: 'socialMedia', actions: [] }],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(400)
  })

  it('accepts a phone-banking activity condition', async () => {
    await seedWinCampaign()

    const result = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Phone banked',
        activityConditions: [
          { outreachType: 'phoneBanking', actions: ['answered', 'no_answer'] },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)
    expect(result.data.activityConditions).toEqual([
      expect.objectContaining({
        outreachType: 'phoneBanking',
        actions: ['answered', 'no_answer'],
      }),
    ])
  })

  it('rejects a specific outreachId that has not completed', async () => {
    const campaign = await seedWinCampaign()
    const pending = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: WIN_SLUG,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending,
      },
    })

    const result = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Not completed',
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: pending.id,
            actions: ['responded'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(400)
  })

  it('rejects an outreachId owned by another org', async () => {
    await seedWinCampaign()
    const OTHER_SLUG = 'campaign-other-activity-condition'
    await service.prisma.organization.create({
      data: { slug: OTHER_SLUG, ownerId: service.user.id },
    })
    const otherCampaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${OTHER_SLUG}-campaign`,
        organizationSlug: OTHER_SLUG,
        isPro: true,
      },
    })
    const otherOutreach = await seedCompletedOutreach(
      otherCampaign.id,
      OTHER_SLUG,
      OutreachType.text,
    )

    const result = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Cross org',
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: otherOutreach.id,
            actions: ['responded'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(400)
  })

  it('rejects an outreachId whose channel does not match the condition', async () => {
    const campaign = await seedWinCampaign()
    const textOutreach = await seedCompletedOutreach(
      campaign.id,
      WIN_SLUG,
      OutreachType.text,
    )

    const result = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Channel mismatch',
        activityConditions: [
          {
            outreachType: 'robocall',
            outreachId: textOutreach.id,
            actions: ['answered'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(400)
  })

  it('rejects a doorKnocking condition with any outreachId', async () => {
    const campaign = await seedWinCampaign()
    const outreach = await seedCompletedOutreach(
      campaign.id,
      WIN_SLUG,
      OutreachType.text,
    )

    const result = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Door knock specific',
        activityConditions: [
          {
            outreachType: 'doorKnocking',
            outreachId: outreach.id,
            actions: ['answered'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(400)
  })

  it('accepts a phoneBanking condition pinned to a completed campaign', async () => {
    const campaign = await seedWinCampaign()
    const outreach = await seedCompletedNativePhoneBankingOutreach(
      campaign.id,
      WIN_SLUG,
    )

    const result = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Phone banked specific',
        activityConditions: [
          {
            outreachType: 'phoneBanking',
            outreachId: outreach.id,
            actions: ['answered'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)
    expect(result.data.activityConditions).toHaveLength(1)
    expect(result.data.activityConditions[0].outreachId).toBe(outreach.id)
  })

  it('accepts a phoneBanking condition pinned to a nativePhoneBanking envelope', async () => {
    const campaign = await seedWinCampaign()
    const outreach = await seedCompletedNativePhoneBankingOutreach(
      campaign.id,
      WIN_SLUG,
    )
    expect(outreach.outreachType).toBe(OutreachType.nativePhoneBanking)

    const result = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Native phone banked specific',
        activityConditions: [
          {
            outreachType: 'phoneBanking',
            outreachId: outreach.id,
            actions: ['support_yes'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)
  })

  it('rejects a legacy phoneBanking outreach with no phoneBankingListId', async () => {
    const campaign = await seedWinCampaign()
    const legacyPhoneBankingOutreach = await seedCompletedOutreach(
      campaign.id,
      WIN_SLUG,
      OutreachType.phoneBanking,
    )

    const result = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Legacy phone banking specific',
        activityConditions: [
          {
            outreachType: 'phoneBanking',
            outreachId: legacyPhoneBankingOutreach.id,
            actions: ['answered'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(400)
  })

  it('accepts a legacy outreach (organizationSlug null) via the campaign join', async () => {
    const campaign = await seedWinCampaign()
    const legacyOutreach = await seedCompletedOutreach(
      campaign.id,
      null,
      OutreachType.text,
    )

    const result = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Legacy outreach',
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: legacyOutreach.id,
            actions: ['responded'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)
    expect(result.data.activityConditions).toHaveLength(1)
  })

  it('rejects a legacy outreach (organizationSlug null) owned by another org', async () => {
    await seedWinCampaign()
    const OTHER_SLUG = 'campaign-other-legacy-outreach'
    await service.prisma.organization.create({
      data: { slug: OTHER_SLUG, ownerId: service.user.id },
    })
    const otherCampaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${OTHER_SLUG}-campaign`,
        organizationSlug: OTHER_SLUG,
        isPro: true,
      },
    })
    const otherLegacyOutreach = await seedCompletedOutreach(
      otherCampaign.id,
      null,
      OutreachType.text,
    )

    const result = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Cross org legacy outreach',
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: otherLegacyOutreach.id,
            actions: ['responded'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(400)
  })

  it('leaves existing condition rows untouched when a PUT omits activityConditions', async () => {
    const campaign = await seedWinCampaign()
    const completedText = await seedCompletedOutreach(
      campaign.id,
      WIN_SLUG,
      OutreachType.text,
    )
    const created = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Has conditions',
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: completedText.id,
            actions: ['responded'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    const id = created.data.id as number

    const updated = await service.client.put(
      `/v1/voters/voter-file/filter/${id}`,
      { name: 'Renamed only' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(updated.status).toBe(200)
    expect(updated.data.name).toBe('Renamed only')
    expect(updated.data.activityConditions).toHaveLength(1)
    expect(
      await service.prisma.voterFileFilterActivityCondition.count({
        where: { voterFileFilterId: id },
      }),
    ).toBe(1)
  })
})

// End-to-end coverage of the resolution engine (ENG-10704) through the real
// /v1/contacts routes: seeded interaction rows -> a saved segment carrying
// activityConditions/supportStatus -> the outgoing people-api `filters.id`
// payload. The people-api HTTP call is mocked (this suite doesn't run
// people-api); the set composition itself is asserted here via the outgoing
// request, and unit-tested exhaustively in
// activityConditionResolution.service.test.ts.
describe('resolution engine: list/count/download honor conditions + supportStatus', () => {
  const stubDistrict = () =>
    vi
      .spyOn(service.app.get(ElectionsService), 'getDistrict')
      .mockResolvedValue({
        id: DISTRICT_ID,
        state: 'CA',
        L2DistrictType: 'County',
        L2DistrictName: 'Test County',
      })

  // People data resolves through the in-process people-db services now
  // (VoterQueryService for list/count, VoterDownloadService for the CSV
  // stream) instead of the legacy people-api HTTP client — this suite
  // doesn't run a real people-db, so both are stubbed.
  const stubPeopleApi = (totalResults = 0) => {
    const findPeople = vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        people: [],
        pagination: {
          totalResults,
          currentPage: 1,
          pageSize: 50,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      } as never)
    const streamPeopleCsv = vi
      .spyOn(service.app.get(VoterDownloadService), 'streamPeopleCsv')
      .mockImplementation(async (_dto, res) => {
        res.raw.setHeader('Content-Type', 'text/csv')
        res.raw.end('lalVoterId\n')
      })
    return { findPeople, streamPeopleCsv }
  }

  beforeEach(async () => {
    await seedWinCampaign()
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
    stubDistrict()
  })

  const outgoingFiltersFor = (
    spy:
      | ReturnType<typeof stubPeopleApi>['findPeople']
      | ReturnType<typeof stubPeopleApi>['streamPeopleCsv'],
  ) => {
    const calls = spy.mock.calls
    const call = calls[calls.length - 1] as [{ filters: FilterData }]
    return reconstructFilters(call[0].filters)
  }

  it('a single condition (text, specific outreach, no_response) resolves the exact seeded people on list/count/download', async () => {
    const campaign = await service.prisma.campaign.findFirstOrThrow({
      where: { organizationSlug: WIN_SLUG },
    })
    const outreach = await seedCompletedOutreach(
      campaign.id,
      WIN_SLUG,
      OutreachType.text,
    )
    const texts = service.app.get(ContactInteractionTextService)
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: PERSON_NO_RESPONSE,
      occurredAt: new Date(),
      outreachId: outreach.id,
    })
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: PERSON_RESPONDED,
      occurredAt: new Date(),
      outreachId: outreach.id,
      respondedAt: new Date(),
    })

    const segment = await service.prisma.voterFileFilter.create({
      data: {
        organizationSlug: WIN_SLUG,
        name: 'No response',
        activityConditions: {
          create: [
            {
              outreachType: OutreachType.text,
              outreachId: outreach.id,
              actions: ['no_response'],
            },
          ],
        },
      },
    })

    const post = stubPeopleApi()

    const list = await service.client.get(
      `/v1/contacts?segment=${segment.id}`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(list.status).toBe(200)
    expect(outgoingFiltersFor(post.findPeople)).toEqual({
      id: { in: [PERSON_NO_RESPONSE] },
    })

    const count = await service.client.post(
      '/v1/contacts/count',
      {
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
    expect(count.status).toBe(201)
    expect(outgoingFiltersFor(post.findPeople)).toEqual({
      id: { in: [PERSON_NO_RESPONSE] },
    })

    const download = await service.client.get(
      `/v1/contacts/download?segment=${segment.id}`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(download.status).toBe(200)
    expect(outgoingFiltersFor(post.streamPeopleCsv)).toEqual({
      id: { in: [PERSON_NO_RESPONSE] },
    })
  })

  it('two conditions AND: only people present in both sets return', async () => {
    const campaign = await service.prisma.campaign.findFirstOrThrow({
      where: { organizationSlug: WIN_SLUG },
    })
    const textOutreach = await seedCompletedOutreach(
      campaign.id,
      WIN_SLUG,
      OutreachType.text,
    )
    const robocallOutreach = await seedCompletedOutreach(
      campaign.id,
      WIN_SLUG,
      OutreachType.robocall,
    )
    const texts = service.app.get(ContactInteractionTextService)
    const robocalls = service.app.get(ContactInteractionRobocallService)

    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: PERSON_BOTH,
      occurredAt: new Date(),
      outreachId: textOutreach.id,
      respondedAt: new Date(),
    })
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: PERSON_TEXT_ONLY,
      occurredAt: new Date(),
      outreachId: textOutreach.id,
      respondedAt: new Date(),
    })
    await robocalls.create({
      organizationSlug: WIN_SLUG,
      personId: PERSON_BOTH,
      occurredAt: new Date(),
      outreachId: robocallOutreach.id,
      answeredAt: new Date(),
    })

    const post = stubPeopleApi()

    const count = await service.client.post(
      '/v1/contacts/count',
      {
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: textOutreach.id,
            actions: ['responded'],
          },
          {
            outreachType: 'robocall',
            outreachId: robocallOutreach.id,
            actions: ['answered'],
          },
        ],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(count.status).toBe(201)
    expect(outgoingFiltersFor(post.findPeople)).toEqual({
      id: { in: [PERSON_BOTH] },
    })
  })

  it('supportStatus: [supporter] resolves exactly the people whose latest door-knock support answer is supporter', async () => {
    const doorKnocks = service.app.get(ContactInteractionDoorKnockService)
    await doorKnocks.create({
      organizationSlug: WIN_SLUG,
      personId: PERSON_SUPPORTER,
      occurredAt: new Date(),
      outcome: DoorKnockOutcome.answered,
      supportAnswer: SupportAnswer.supporter,
      manual: true,
    })
    await doorKnocks.create({
      organizationSlug: WIN_SLUG,
      personId: PERSON_NON_SUPPORTER,
      occurredAt: new Date(),
      outcome: DoorKnockOutcome.answered,
      supportAnswer: SupportAnswer.non_supporter,
      manual: true,
    })

    const post = stubPeopleApi()

    const count = await service.client.post(
      '/v1/contacts/count',
      { supportStatus: ['supporter'] },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(count.status).toBe(201)
    expect(outgoingFiltersFor(post.findPeople)).toEqual({
      id: { in: [PERSON_SUPPORTER] },
    })
  })

  it('supportStatus including unknown resolves the notIn complement of supporters/non-supporters', async () => {
    const doorKnocks = service.app.get(ContactInteractionDoorKnockService)
    await doorKnocks.create({
      organizationSlug: WIN_SLUG,
      personId: PERSON_SUPPORTER,
      occurredAt: new Date(),
      outcome: DoorKnockOutcome.answered,
      supportAnswer: SupportAnswer.supporter,
      manual: true,
    })
    await doorKnocks.create({
      organizationSlug: WIN_SLUG,
      personId: PERSON_NON_SUPPORTER,
      occurredAt: new Date(),
      outcome: DoorKnockOutcome.answered,
      supportAnswer: SupportAnswer.non_supporter,
      manual: true,
    })

    const post = stubPeopleApi()

    const count = await service.client.post(
      '/v1/contacts/count',
      { supportStatus: ['unknown'] },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(count.status).toBe(201)
    const filters = outgoingFiltersFor(post.findPeople)
    const idFilter = filters.id as { notIn: string[] }
    expect(idFilter.notIn.sort()).toEqual([
      PERSON_SUPPORTER,
      PERSON_NON_SUPPORTER,
    ])
  })

  it('composes a support-status filter with a demographic filter (AND) through people-api', async () => {
    const doorKnocks = service.app.get(ContactInteractionDoorKnockService)
    await doorKnocks.create({
      organizationSlug: WIN_SLUG,
      personId: PERSON_SUPPORTER,
      occurredAt: new Date(),
      outcome: DoorKnockOutcome.answered,
      supportAnswer: SupportAnswer.supporter,
      manual: true,
    })

    const post = stubPeopleApi()

    const count = await service.client.post(
      '/v1/contacts/count',
      { supportStatus: ['supporter'], partyDemocrat: true },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(count.status).toBe(201)
    expect(outgoingFiltersFor(post.findPeople)).toEqual({
      politicalParty: { eq: 'Democratic' },
      id: { in: [PERSON_SUPPORTER] },
    })
  })

  it('short-circuits to zero results without calling people-api when a condition matches nobody', async () => {
    const post = stubPeopleApi()

    const count = await service.client.post(
      '/v1/contacts/count',
      {
        activityConditions: [{ outreachType: 'text', actions: ['responded'] }],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(count.status).toBe(201)
    expect(count.data.count).toBe(0)
    expect(post.findPeople).not.toHaveBeenCalled()
  })
})

describe('locking a segment already used for outreach', () => {
  it('returns 409 on PUT and DELETE once firstUsedForOutreachAt is set', async () => {
    await seedWinCampaign()
    const locked = await service.prisma.voterFileFilter.create({
      data: {
        organizationSlug: WIN_SLUG,
        name: 'Locked list',
        firstUsedForOutreachAt: new Date(),
      },
    })

    const putResult = await service.client.put(
      `/v1/voters/voter-file/filter/${locked.id}`,
      { name: 'Try to edit' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(putResult.status).toBe(409)

    const deleteResult = await service.client.delete(
      `/v1/voters/voter-file/filter/${locked.id}`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(deleteResult.status).toBe(409)

    expect(
      await service.prisma.voterFileFilter.findUnique({
        where: { id: locked.id },
      }),
    ).not.toBeNull()
  })

  it('edits normally when the filter has never been used for outreach', async () => {
    await seedWinCampaign()
    const unlocked = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: WIN_SLUG, name: 'Unlocked list' },
    })

    const putResult = await service.client.put(
      `/v1/voters/voter-file/filter/${unlocked.id}`,
      { name: 'Edited' },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(putResult.status).toBe(200)
    expect(putResult.data.name).toBe('Edited')
  })
})

describe('segmentToFilters output for a Win segment', () => {
  it('includes the political-party criterion alongside other filters', () => {
    const segment = {
      partyIndependent: true,
      partyDemocrat: true,
      genderFemale: true,
      audienceSuperVoters: true,
    } as VoterFileFilter

    const filters = convertVoterFileFilterToFilters(segment)

    expect(filters.politicalParty).toEqual({
      in: ['Independent', 'Democratic'],
    })
    expect(filters.gender).toEqual({ eq: 'F' })
    expect(filters.voterStatus).toEqual({ eq: 'Super' })
  })
})

describe('count + download for a saved segment', () => {
  const stubDistrictWithL2Data = () =>
    vi
      .spyOn(service.app.get(ElectionsService), 'getDistrict')
      .mockResolvedValue({
        id: DISTRICT_ID,
        state: 'CA',
        L2DistrictType: 'County',
        L2DistrictName: 'Test County',
      })

  it('counts a saved segment scoped to the campaign district incl. party', async () => {
    await seedWinCampaign()
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
    stubDistrictWithL2Data()

    const segment = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: WIN_SLUG, ...partySegmentBody },
    })

    const findPeople = vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        people: [],
        pagination: {
          totalResults: 42,
          currentPage: 1,
          pageSize: 50,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      } as never)

    const result = await service.client.get(
      `/v1/contacts?segment=${segment.id}`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(200)
    expect(result.data.pagination.totalResults).toBe(42)
    const dto = findPeople.mock.calls[0]?.[0]
    expect(dto).toMatchObject({ districtId: DISTRICT_ID })
    const sentFilters = reconstructFilters(dto!.filters)
    expect(sentFilters).toMatchObject({
      politicalParty: { eq: 'Independent' },
      gender: { eq: 'F' },
      voterStatus: { eq: 'Super' },
    })
    // A segment with no activityConditions/supportStatus never sends an `id`
    // key — the resolution engine must be byte-identical to pre-ENG-10704
    // behavior when neither is set.
    expect(sentFilters).not.toHaveProperty('id')
  })

  it('downloads a saved segment scoped to the campaign district incl. party', async () => {
    await seedWinCampaign()
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
    stubDistrictWithL2Data()

    const segment = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: WIN_SLUG, ...partySegmentBody },
    })

    const streamPeopleCsv = vi
      .spyOn(service.app.get(VoterDownloadService), 'streamPeopleCsv')
      .mockImplementation(async (_dto, res) => {
        res.raw.setHeader('Content-Type', 'text/csv')
        res.raw.end('lalVoterId\n')
      })

    const result = await service.client.get(
      `/v1/contacts/download?segment=${segment.id}`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(200)
    const dto = streamPeopleCsv.mock.calls[0]?.[0]
    expect(dto).toMatchObject({ districtId: DISTRICT_ID })
    expect(reconstructFilters(dto!.filters)).toMatchObject({
      politicalParty: { eq: 'Independent' },
    })
  })
})
