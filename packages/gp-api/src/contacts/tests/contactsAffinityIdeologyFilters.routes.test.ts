import { randomUUID } from 'node:crypto'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// The three dimensions added for recommended lists (affinity, ideology,
// hasAnyPhone). The count route runs the same
// convertVoterFileFilterToFilters translation the saved-segment
// list/download paths use, so pinning what reaches the people-db query here
// pins it for all of them. The SQL each translated key compiles to is
// asserted directly in databricksVoterSql.util.test.ts.
describe('POST /v1/contacts/count — affinity/ideology/phone', () => {
  const setupWinProOrg = async (suffix: string) => {
    const slug = `campaign-affinity-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        // The people-db DTOs run through Zod, whose districtId is z.guid() —
        // a non-UUID placeholder fails validation here.
        overrideDistrictId: randomUUID(),
      },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${slug}-campaign`,
        organizationSlug: slug,
        isPro: true,
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
    return slug
  }

  const setupEoOrg = async (suffix: string) => {
    const slug = `eo-affinity-${suffix}-${Date.now()}`
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
          totalResults: 9,
          currentPage: 1,
          pageSize: 1,
          totalPages: 9,
          hasNextPage: true,
          hasPreviousPage: false,
        },
        people: [],
      })

  const countWith = async (
    slug: string,
    body: Record<string, boolean>,
  ): Promise<ReturnType<typeof spyOnFindPeople>> => {
    const findPeopleSpy = spyOnFindPeople()
    const response = await service.client.post('/v1/contacts/count', body, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })
    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 9 })
    return findPeopleSpy
  }

  it('forwards independentAffinity as a Yes enum selection', async () => {
    const slug = await setupWinProOrg('affinity')
    const findPeopleSpy = await countWith(slug, { independentAffinity: true })

    expect(findPeopleSpy.mock.calls[0]?.[0]?.filters.filterOperators).toEqual(
      expect.objectContaining({
        independentAffinity: { operator: 'eq', value: 'Yes' },
      }),
    )
  })

  it('forwards a single ideology selection as an eq', async () => {
    const slug = await setupWinProOrg('ideology-one')
    const findPeopleSpy = await countWith(slug, { ideologyModerate: true })

    expect(findPeopleSpy.mock.calls[0]?.[0]?.filters.filterOperators).toEqual(
      expect.objectContaining({
        ideology: { operator: 'eq', value: 'Moderate' },
      }),
    )
  })

  // The label says Progressive but the mart column says Liberal; the wire
  // vocabulary follows the data, so a UI selection of "Progressive" must
  // arrive as Liberal or it matches nobody.
  it('sends the Progressive pill through as the column value Liberal', async () => {
    const slug = await setupWinProOrg('progressive')
    const findPeopleSpy = await countWith(slug, { ideologyLiberal: true })

    expect(
      findPeopleSpy.mock.calls[0]?.[0]?.filters.filterValues.ideology,
    ).toEqual(['Liberal'])
  })

  // hf_ideology_general is ~40% NULL, so Unknown is a real reportable
  // segment. It has to reach the query as its own value rather than being
  // dropped (which would silently return the complement of the request).
  it('forwards the ideology Unknown bucket as a value, not a dropped key', async () => {
    const slug = await setupWinProOrg('ideology-unknown')
    const findPeopleSpy = await countWith(slug, { ideologyUnknown: true })

    expect(findPeopleSpy.mock.calls[0]?.[0]?.filters.filterOperators).toEqual(
      expect.objectContaining({
        ideology: { operator: 'eq', value: 'Unknown' },
      }),
    )
  })

  it('forwards Unknown alongside real ideology values in one in-list', async () => {
    const slug = await setupWinProOrg('ideology-mixed')
    const findPeopleSpy = await countWith(slug, {
      ideologyConservative: true,
      ideologyUnknown: true,
    })

    expect(
      findPeopleSpy.mock.calls[0]?.[0]?.filters.filterValues.ideology,
    ).toEqual(['Conservative', 'Unknown'])
  })

  it('omits ideology entirely when no bucket is selected', async () => {
    const slug = await setupWinProOrg('ideology-none')
    const findPeopleSpy = await countWith(slug, { ideologyConservative: false })

    expect(
      findPeopleSpy.mock.calls[0]?.[0]?.filters.filterOperators.ideology,
    ).toBeUndefined()
  })

  it('persists hasAnyPhone as a presence filter', async () => {
    const slug = await setupWinProOrg('reachability')
    const findPeopleSpy = await countWith(slug, { hasAnyPhone: true })

    expect(findPeopleSpy.mock.calls[0]?.[0]?.filters.filterOperators).toEqual(
      expect.objectContaining({
        hasAnyPhone: { operator: 'is', value: 'not_null' },
      }),
    )
  })

  // Redundant rather than contradictory: every phone value is presence-only,
  // so hasAnyPhone AND hasCellPhone is just hasCellPhone. The resolver keeps
  // plain AND semantics and the wizard is what prevents the selection.
  it('keeps AND semantics when hasAnyPhone is combined with hasCellPhone', async () => {
    const slug = await setupWinProOrg('phone-combo')
    const findPeopleSpy = await countWith(slug, {
      hasAnyPhone: true,
      hasCellPhone: true,
    })

    expect(findPeopleSpy.mock.calls[0]?.[0]?.filters.filters.sort()).toEqual([
      'hasAnyPhone',
      'hasCellPhone',
    ])
  })

  // hasAnyPhone is plain contactability, and Serve runs phone banking and
  // robocall, so it is the one recommended-list option a Serve org keeps.
  it('serves hasAnyPhone to a Serve (eo-) org', async () => {
    const slug = await setupEoOrg('shared')
    const findPeopleSpy = await countWith(slug, { hasAnyPhone: true })

    expect(findPeopleSpy).toHaveBeenCalledTimes(1)
  })

  // Both describe how someone votes in a contested election, which has no
  // meaning for an office holder. A permanent product rule, not the flag's
  // doing — the flag never reaches gp-api at all.
  it.each([
    ['independentAffinity', { independentAffinity: true }],
    ['ideology', { ideologyConservative: true }],
  ])('rejects a %s selection for a Serve (eo-) org', async (key, body) => {
    const slug = await setupEoOrg(`rejected-${key.toLowerCase()}`)

    const response = await service.client.post('/v1/contacts/count', body, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(400)
  })
})

// A saved list has to carry the new dimensions, which is the whole point of
// the persisted columns: the wire key hasAnyPhone already existed as a
// people-db filter key, but voterFilterBaseSchema stripped it on save, so a
// list built with it silently lost the filter.
describe('POST /v1/voters/voter-file/filter — new dimensions persist', () => {
  const setupWinProOrg = async (suffix: string) => {
    const slug = `campaign-affinity-save-${suffix}-${Date.now()}`
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
      },
    })
    return slug
  }

  it('round-trips all three dimensions through the saved row', async () => {
    const slug = await setupWinProOrg('roundtrip')

    const created = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Persuadable moderates',
        independentAffinity: true,
        ideologyModerate: true,
        ideologyUnknown: true,
        hasAnyPhone: true,
      },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(created.status).toBe(201)

    const saved = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: created.data.id },
    })
    expect({
      independentAffinity: saved.independentAffinity,
      ideologyConservative: saved.ideologyConservative,
      ideologyLiberal: saved.ideologyLiberal,
      ideologyModerate: saved.ideologyModerate,
      ideologyUnknown: saved.ideologyUnknown,
      hasAnyPhone: saved.hasAnyPhone,
    }).toEqual({
      independentAffinity: true,
      ideologyConservative: false,
      ideologyLiberal: false,
      ideologyModerate: true,
      ideologyUnknown: true,
      hasAnyPhone: true,
    })
  })
})
