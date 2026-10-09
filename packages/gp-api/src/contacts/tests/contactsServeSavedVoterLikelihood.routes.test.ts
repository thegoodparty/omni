import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { VoterDownloadService } from '@/peopleDb/services/voterDownload.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'
const VOTER_LIKELIHOOD_MESSAGE =
  'Voter likelihood filtering is not available for this organization'

// A Serve list saved before voter likelihood became Win-only still carries it.
// Every read of that stored list drops the predicate and keeps working; a
// filter supplied in the request is still refused.
describe('a Serve saved list carrying voter likelihood', () => {
  const setupServeOrg = async () => {
    const slug = `eo-saved-likelihood-${randomUUID()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  const createLegacyList = (organizationSlug: string) =>
    service.prisma.voterFileFilter.create({
      data: {
        organizationSlug,
        name: 'Pre-rule list',
        hasCellPhone: true,
        audienceSuperVoters: true,
        voterStatus: ['Likely'],
      },
    })

  const spyOnFindPeople = () =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        pagination: {
          totalResults: 3,
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        people: [],
      })

  const headers = (slug: string) => ({ headers: { [ORG_SLUG_HEADER]: slug } })

  it('lists the stored list without its voter likelihood predicate', async () => {
    const slug = await setupServeOrg()
    const list = await createLegacyList(slug)
    const findPeople = spyOnFindPeople()

    const response = await service.client.get('/v1/contacts', {
      params: { segment: String(list.id) },
      ...headers(slug),
    })

    expect(response.status).toBe(200)
    expect(findPeople).toHaveBeenCalledTimes(1)
    const [dto] = firstOrThrow(findPeople.mock.calls)
    expect(dto.filters).toMatchObject({
      filters: expect.arrayContaining(['hasCellPhone']),
    })
    expect(JSON.stringify(dto)).not.toMatch(/voterStatus|Super|Likely/)
  })

  it('serves the stored list detail without its voter likelihood predicate', async () => {
    const slug = await setupServeOrg()
    const list = await createLegacyList(slug)
    const aggregates = vi
      .spyOn(service.app.get(VoterQueryService), 'getListDetailAggregates')
      .mockResolvedValue({
        count: 3,
        avgAge: null,
        avgIncome: null,
        sms: 3,
        robocall: 0,
        phoneBanking: 3,
        doorKnocking: 0,
      })

    const response = await service.client.get('/v1/contacts/list-detail', {
      params: { segment: String(list.id) },
      ...headers(slug),
    })

    expect(response.status).toBe(200)
    expect(response.data.demographics.people).toBe(3)
    expect(JSON.stringify(firstOrThrow(aggregates.mock.calls)[0])).not.toMatch(
      /voterStatus|Super|Likely/,
    )
  })

  it('downloads the stored list without its voter likelihood predicate', async () => {
    const slug = await setupServeOrg()
    const list = await createLegacyList(slug)
    const stream = vi
      .spyOn(service.app.get(VoterDownloadService), 'streamPeopleCsv')
      .mockImplementation(async (_dto, _dataset, res) => {
        res.raw.end()
      })

    const response = await service.client.get('/v1/contacts/download', {
      params: { segment: String(list.id) },
      ...headers(slug),
    })

    expect(response.status).toBe(200)
    expect(stream).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(firstOrThrow(stream.mock.calls)[0])).not.toMatch(
      /voterStatus|Super|Likely/,
    )
  })

  it('counts the stored list in the overlap union instead of dropping it', async () => {
    const slug = await setupServeOrg()
    await createLegacyList(slug)
    const overlap = vi
      .spyOn(service.app.get(VoterQueryService), 'getOverlapCount')
      .mockResolvedValue({ count: 2 })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { hasLandline: true },
      headers(slug),
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 2 })
    const [dto] = firstOrThrow(overlap.mock.calls)
    expect(dto.savedFilterSets).toHaveLength(1)
    expect(JSON.stringify(dto.savedFilterSets)).not.toMatch(
      /voterStatus|Super|Likely/,
    )
  })

  it('still refuses voter likelihood supplied in a count request', async () => {
    const slug = await setupServeOrg()
    const findPeople = spyOnFindPeople()

    const response = await service.client.post(
      '/v1/contacts/count',
      { audienceSuperVoters: true },
      headers(slug),
    )

    expect(response.status).toBe(400)
    expect(response.data).toMatchObject({ message: VOTER_LIKELIHOOD_MESSAGE })
    expect(findPeople).not.toHaveBeenCalled()
  })

  describe('saving a list', () => {
    it.each([
      ['an audience flag', { audienceLikelyVoters: true }],
      ['a voterStatus array', { voterStatus: ['Super'] }],
    ])('refuses to create a Serve list with %s', async (_label, body) => {
      const slug = await setupServeOrg()

      const response = await service.client.post(
        '/v1/voters/voter-file/filter',
        { name: 'New list', ...body },
        headers(slug),
      )

      expect(response.status).toBe(400)
      expect(response.data).toMatchObject({
        message: VOTER_LIKELIHOOD_MESSAGE,
      })
      expect(
        await service.prisma.voterFileFilter.count({
          where: { organizationSlug: slug },
        }),
      ).toBe(0)
    })

    it('refuses to set voter likelihood on a Serve list', async () => {
      const slug = await setupServeOrg()
      const list = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: slug, name: 'Plain list' },
      })

      const response = await service.client.put(
        `/v1/voters/voter-file/filter/${list.id}`,
        { audienceSuperVoters: true },
        headers(slug),
      )

      expect(response.status).toBe(400)
      expect(response.data).toMatchObject({
        message: VOTER_LIKELIHOOD_MESSAGE,
      })
      const unchanged = await service.prisma.voterFileFilter.findUniqueOrThrow({
        where: { id: list.id },
      })
      expect(unchanged.audienceSuperVoters).toBe(false)
    })

    it('lets an edit clear a stored voter likelihood value', async () => {
      const slug = await setupServeOrg()
      const list = await createLegacyList(slug)

      const response = await service.client.put(
        `/v1/voters/voter-file/filter/${list.id}`,
        {
          audienceSuperVoters: false,
          audienceLikelyVoters: false,
          voterStatus: [],
        },
        headers(slug),
      )

      expect(response.status).toBe(200)
      const cleared = await service.prisma.voterFileFilter.findUniqueOrThrow({
        where: { id: list.id },
      })
      expect(cleared.audienceSuperVoters).toBe(false)
      expect(cleared.voterStatus).toEqual([])
    })

    it('still lets a Win list save voter likelihood', async () => {
      const slug = `campaign-saved-likelihood-${randomUUID()}`
      await service.prisma.organization.create({
        data: {
          slug,
          ownerId: service.user.id,
          overrideDistrictId: randomUUID(),
        },
      })

      const response = await service.client.post(
        '/v1/voters/voter-file/filter',
        { name: 'Win list', audienceSuperVoters: true },
        headers(slug),
      )

      expect(response.status).toBe(201)
      expect(response.data.audienceSuperVoters).toBe(true)
    })
  })
})
