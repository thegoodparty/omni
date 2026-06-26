import { HttpService } from '@nestjs/axios'
import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { FeaturesService } from '@/features/services/features.service'
import { convertVoterFileFilterToFilters } from '@/contacts/utils/voterFileFilter.utils'
import { VoterFileFilter } from '../../generated/prisma'
import { Readable } from 'node:stream'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'

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
  await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${WIN_SLUG}-campaign`,
      organizationSlug: WIN_SLUG,
      isPro,
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
