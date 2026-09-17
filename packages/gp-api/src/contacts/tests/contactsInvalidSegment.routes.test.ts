import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { VoterDownloadService } from '@/peopleDb/services/voterDownload.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// A segment that doesn't resolve used to fall through to an empty FilterObject,
// which means "the whole district" — so a typo'd, deleted, or cross-org list id
// silently served (and downloaded) every voter in the district and reported 200.
// getListDetail already 404'd on the same input; these pin the list and download
// paths to that behavior.
describe('unresolvable segment on the list/download paths', () => {
  const setupOrg = async (suffix: string) => {
    const slug = `eo-invalid-segment-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  const spyOnFindPeople = () =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        pagination: {
          totalResults: 5982,
          currentPage: 1,
          pageSize: 20,
          totalPages: 300,
          hasNextPage: true,
          hasPreviousPage: false,
        },
        people: [],
      })

  it('404s a numeric segment id that does not exist', async () => {
    const slug = await setupOrg('missing')
    const findPeopleSpy = spyOnFindPeople()

    const response = await service.client.get('/v1/contacts', {
      params: { segment: '99999999' },
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(404)
    expect(findPeopleSpy).not.toHaveBeenCalled()
  })

  it('404s a segment owned by another organization', async () => {
    const ownerSlug = await setupOrg('owner')
    const otherSlug = await setupOrg('other')
    const filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: ownerSlug, name: 'Owner list' },
    })
    const findPeopleSpy = spyOnFindPeople()

    const response = await service.client.get('/v1/contacts', {
      params: { segment: String(filter.id) },
      headers: { [ORG_SLUG_HEADER]: otherSlug },
    })

    expect(response.status).toBe(404)
    expect(findPeopleSpy).not.toHaveBeenCalled()
  })

  // parseInt('12abc') is 12, so a malformed id used to resolve whichever list
  // happened to carry that numeric prefix.
  it('404s a malformed segment instead of resolving its numeric prefix', async () => {
    const slug = await setupOrg('malformed')
    const filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: slug, name: 'Real list' },
    })
    const findPeopleSpy = spyOnFindPeople()

    const response = await service.client.get('/v1/contacts', {
      params: { segment: `${filter.id}abc` },
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(404)
    expect(findPeopleSpy).not.toHaveBeenCalled()
  })

  it('404s an unresolvable segment on the CSV download instead of streaming the district', async () => {
    const slug = await setupOrg('download')
    const streamSpy = vi
      .spyOn(service.app.get(VoterDownloadService), 'streamPeopleCsv')
      .mockResolvedValue(undefined)

    const response = await service.client.get('/v1/contacts/download', {
      params: { segment: '99999999' },
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(404)
    expect(streamSpy).not.toHaveBeenCalled()
  })

  it('still serves a built-in segment name', async () => {
    const slug = await setupOrg('builtin')
    const findPeopleSpy = spyOnFindPeople()

    const response = await service.client.get('/v1/contacts', {
      params: { segment: 'all' },
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(200)
    expect(findPeopleSpy).toHaveBeenCalled()
  })

  it("still serves the org's own saved segment", async () => {
    const slug = await setupOrg('own')
    const filter = await service.prisma.voterFileFilter.create({
      data: {
        organizationSlug: slug,
        name: 'Super voters',
        audienceSuperVoters: true,
      },
    })
    const findPeopleSpy = spyOnFindPeople()

    const response = await service.client.get('/v1/contacts', {
      params: { segment: String(filter.id) },
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(200)
    expect(findPeopleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          filterOperators: expect.objectContaining({
            voterStatus: { operator: 'eq', value: 'Super' },
          }),
        }),
      }),
    )
  })
})
