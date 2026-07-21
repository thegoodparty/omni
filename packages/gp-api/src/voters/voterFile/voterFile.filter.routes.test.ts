import { HttpService } from '@nestjs/axios'
import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { FeaturesService } from '@/features/services/features.service'
import { convertVoterFileFilterToFilters } from '@/contacts/utils/voterFileFilter.utils'
import { ContactInteractionDoorKnockService } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from '@/contactInteraction/services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import {
  DoorKnockOutcome,
  OutreachStatus,
  OutreachType,
  SupportAnswer,
  VoterFileFilter,
} from '../../generated/prisma'
import { Readable } from 'node:stream'
import { of } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = useTestService()

const WIN_SLUG = 'campaign-win-segments'
const ORG_SLUG_HEADER = 'X-Organization-Slug'
const DISTRICT_ID = 'district-win-segments'

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
        activityConditions: [{ outreachType: 'phoneBanking', actions: [] }],
      },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(400)
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
        projectedTurnout: null,
      })

  const stubPeopleApi = (totalResults = 0) =>
    vi.spyOn(service.app.get(HttpService), 'post').mockImplementation(((
      url: string,
    ) =>
      url.includes('/download')
        ? of({ data: Readable.from(['lalVoterId\n']) })
        : of({
            data: { people: [], pagination: { totalResults } },
          })) as never)

  beforeEach(async () => {
    await seedWinCampaign()
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
    stubDistrict()
  })

  const outgoingFiltersFor = (
    post: ReturnType<typeof stubPeopleApi>,
    pathSuffix: string,
  ) => {
    const call = post.mock.calls.find((call) =>
      String(call[0]).endsWith(pathSuffix),
    )
    return (call?.[1] as { filters: Record<string, unknown> }).filters
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
      personId: 'p-no-response',
      occurredAt: new Date(),
      outreachId: outreach.id,
    })
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: 'p-responded',
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
    expect(outgoingFiltersFor(post, '/v1/people')).toEqual({
      id: { in: ['p-no-response'] },
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
    expect(outgoingFiltersFor(post, '/v1/people')).toEqual({
      id: { in: ['p-no-response'] },
    })

    const download = await service.client.get(
      `/v1/contacts/download?segment=${segment.id}`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )
    expect(download.status).toBe(200)
    expect(outgoingFiltersFor(post, '/v1/people/download')).toEqual({
      id: { in: ['p-no-response'] },
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
      personId: 'p-both',
      occurredAt: new Date(),
      outreachId: textOutreach.id,
      respondedAt: new Date(),
    })
    await texts.create({
      organizationSlug: WIN_SLUG,
      personId: 'p-text-only',
      occurredAt: new Date(),
      outreachId: textOutreach.id,
      respondedAt: new Date(),
    })
    await robocalls.create({
      organizationSlug: WIN_SLUG,
      personId: 'p-both',
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
    expect(outgoingFiltersFor(post, '/v1/people')).toEqual({
      id: { in: ['p-both'] },
    })
  })

  it('supportStatus: [supporter] resolves exactly the people whose latest door-knock support answer is supporter', async () => {
    const doorKnocks = service.app.get(ContactInteractionDoorKnockService)
    await doorKnocks.create({
      organizationSlug: WIN_SLUG,
      personId: 'p-supporter',
      occurredAt: new Date(),
      outcome: DoorKnockOutcome.answered,
      supportAnswer: SupportAnswer.supporter,
      manual: true,
    })
    await doorKnocks.create({
      organizationSlug: WIN_SLUG,
      personId: 'p-non-supporter',
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
    expect(outgoingFiltersFor(post, '/v1/people')).toEqual({
      id: { in: ['p-supporter'] },
    })
  })

  it('supportStatus including unknown resolves the notIn complement of supporters/non-supporters', async () => {
    const doorKnocks = service.app.get(ContactInteractionDoorKnockService)
    await doorKnocks.create({
      organizationSlug: WIN_SLUG,
      personId: 'p-supporter',
      occurredAt: new Date(),
      outcome: DoorKnockOutcome.answered,
      supportAnswer: SupportAnswer.supporter,
      manual: true,
    })
    await doorKnocks.create({
      organizationSlug: WIN_SLUG,
      personId: 'p-non-supporter',
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
    const filters = outgoingFiltersFor(post, '/v1/people') as {
      id: { notIn: string[] }
    }
    expect(filters.id.notIn.sort()).toEqual(['p-non-supporter', 'p-supporter'])
  })

  it('composes a support-status filter with a demographic filter (AND) through people-api', async () => {
    const doorKnocks = service.app.get(ContactInteractionDoorKnockService)
    await doorKnocks.create({
      organizationSlug: WIN_SLUG,
      personId: 'p-supporter',
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
    expect(outgoingFiltersFor(post, '/v1/people')).toEqual({
      politicalParty: { eq: 'Democratic' },
      id: { in: ['p-supporter'] },
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
    expect(post).not.toHaveBeenCalled()
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
        projectedTurnout: null,
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

    const post = vi.spyOn(service.app.get(HttpService), 'post').mockReturnValue(
      of({
        data: {
          people: [],
          pagination: { totalResults: 42, currentPage: 1, totalPages: 1 },
        },
      }) as never,
    )

    const result = await service.client.get(
      `/v1/contacts?segment=${segment.id}`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(200)
    expect(result.data.pagination.totalResults).toBe(42)
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/v1/people'),
      expect.objectContaining({
        districtId: DISTRICT_ID,
        filters: expect.objectContaining({
          politicalParty: { eq: 'Independent' },
          gender: { eq: 'F' },
          voterStatus: { eq: 'Super' },
        }),
      }),
      expect.any(Object),
    )
    // A segment with no activityConditions/supportStatus never sends an `id`
    // key — the resolution engine must be byte-identical to pre-ENG-10704
    // behavior when neither is set.
    const body = post.mock.calls[0]?.[1] as { filters: Record<string, unknown> }
    expect(body.filters).not.toHaveProperty('id')
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

    const post = vi
      .spyOn(service.app.get(HttpService), 'post')
      .mockImplementation(((url: string) =>
        url.includes('/download')
          ? of({ data: Readable.from(['lalVoterId\n']) })
          : of({
              data: { people: [], pagination: {} },
            })) as never)

    const result = await service.client.get(
      `/v1/contacts/download?segment=${segment.id}`,
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(200)
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/v1/people/download'),
      expect.objectContaining({
        districtId: DISTRICT_ID,
        filters: expect.objectContaining({
          politicalParty: { eq: 'Independent' },
        }),
      }),
      expect.objectContaining({ responseType: 'stream' }),
    )
  })
})
