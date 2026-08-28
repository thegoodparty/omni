import { randomUUID } from 'node:crypto'
import { useTestService } from '@/test-service'
import { ContactStatusField } from '@/generated/prisma'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// ENG-10838: override-aware Voter Likelihood filtering. A person manually set
// to a bucket (ContactCurrentStatus.field = voter_likelihood) must match that
// bucket's filter even when their seed voterStatus disagrees, and vice versa.
// Drives POST /v1/contacts/count through the real HTTP pipeline (auth, org
// resolution, Pro gate, ContactStatusService reads) with a real Postgres
// database; only the in-process people-db list query itself is stubbed — the
// actual SQL composition (the OR scoped to voterStatus only) is unit-tested
// directly in databricksVoterSql.util.test.ts.
describe('POST /v1/contacts/count — Voter Likelihood override resolution', () => {
  // Win (non-`eo-`) Pro org. assertVoterDataEligibility resolves the
  // district via election-api (a real HttpService.get) — stub it with L2 data
  // present so the org is eligible.
  const setupWinProOrg = async (suffix: string) => {
    const slug = `campaign-likelihood-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        // The ported people-db DTOs run through Zod, whose districtId is
        // z.guid() — a non-UUID placeholder fails validation here.
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
    const slug = `eo-likelihood-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  const setOverride = (
    organizationSlug: string,
    personId: string,
    value: string,
  ) =>
    service.prisma.contactCurrentStatus.create({
      data: {
        organizationSlug,
        personId,
        field: ContactStatusField.voter_likelihood,
        value,
      },
    })

  // The count route reads response.pagination.totalResults; the idOverrides
  // and voterStatus filter the route forwards ride the DTO the in-process
  // VoterQueryService.findPeople receives.
  const spyOnFindPeople = () =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        pagination: {
          totalResults: 1,
          currentPage: 1,
          pageSize: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        people: [],
      })

  it('a Super override matches a Super filter and is excluded from an Unlikely filter', async () => {
    const slug = await setupWinProOrg('super-override')
    const overriddenPersonId = randomUUID()
    await setOverride(slug, overriddenPersonId, 'super')

    const findPeopleSpy = spyOnFindPeople()
    await service.client.post(
      '/v1/contacts/count',
      { audienceSuperVoters: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )
    expect(findPeopleSpy.mock.calls[0]?.[0]?.idOverrides).toEqual({
      include: [overriddenPersonId],
    })

    findPeopleSpy.mockClear()
    await service.client.post(
      '/v1/contacts/count',
      { audienceUnlikelyVoters: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )
    // Overridden to Super, so they're excluded from the Unlikely bucket even
    // though their seed voterStatus (never set here — defaults null/Unknown)
    // would not otherwise have matched anyway; the exclude set proves the
    // person is a KNOWN override the seed filter must not silently re-admit
    // via some other codepath.
    expect(findPeopleSpy.mock.calls[0]?.[0]?.idOverrides).toEqual({
      exclude: [overriddenPersonId],
    })
  })

  it('a person overridden to Super still appears in a Super-filtered count, absent from an Unlikely-filtered one', async () => {
    const slug = await setupWinProOrg('seed-mismatch')
    const overriddenPersonId = randomUUID()
    await setOverride(slug, overriddenPersonId, 'super')

    const findPeopleSpy = spyOnFindPeople()
    await service.client.post(
      '/v1/contacts/count',
      { audienceUnlikelyVoters: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )
    const dto = findPeopleSpy.mock.calls[0]?.[0]
    // The seed side of the filter is a straight one-to-one 'Unlikely' match
    // now that Unreliable has its own member (no more expand-to-the-
    // collapsed-seed-values fix), and the Super-overridden person is
    // excluded despite never matching that seed value in the first place —
    // proves exclude is populated from the override table, not derived from
    // "would the seed filter have matched".
    expect(dto?.filters.filterOperators.voterStatus).toEqual({
      operator: 'eq',
      value: 'Unlikely',
    })
    expect(dto?.idOverrides).toEqual({ exclude: [overriddenPersonId] })
  })

  it('a person with no override is unaffected — no idOverrides sent, seed filter matches only Unlikely', async () => {
    const slug = await setupWinProOrg('no-override')
    const findPeopleSpy = spyOnFindPeople()

    await service.client.post(
      '/v1/contacts/count',
      { audienceUnlikelyVoters: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const dto = findPeopleSpy.mock.calls[0]?.[0]
    expect(dto?.filters.filterOperators.voterStatus).toEqual({
      operator: 'eq',
      value: 'Unlikely',
    })
    expect(dto?.idOverrides).toBeUndefined()
  })

  it('orgs with zero overrides send idOverrides as undefined (dropped by JSON serialization, byte-identical wire payload)', async () => {
    const slug = await setupWinProOrg('zero-overrides')
    const findPeopleSpy = spyOnFindPeople()

    await service.client.post(
      '/v1/contacts/count',
      { audienceSuperVoters: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(findPeopleSpy.mock.calls[0]?.[0]?.idOverrides).toBeUndefined()
  })

  it('an override-included person still respects other selected filters (gender) — the include set does not bypass them', async () => {
    const slug = await setupWinProOrg('other-filters')
    const overriddenPersonId = randomUUID()
    await setOverride(slug, overriddenPersonId, 'super')
    const findPeopleSpy = spyOnFindPeople()

    await service.client.post(
      '/v1/contacts/count',
      { audienceSuperVoters: true, genderFemale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const dto = findPeopleSpy.mock.calls[0]?.[0]
    // idOverrides is a request-level sibling of `filters`, never merged into
    // it — buildVoterFiltersSql (unit-tested directly) is what proves the OR
    // composite stays scoped to the voterStatus clause only, AND-ed with
    // gender at the top level. This asserts gp-api sends both independently
    // rather than, say, dropping gender once an override applies.
    expect(dto?.idOverrides).toEqual({ include: [overriddenPersonId] })
    expect(dto?.filters.filterOperators.gender).toEqual({
      operator: 'eq',
      value: 'F',
    })
  })

  it('does not resolve overrides at all when no likelihood filter is selected', async () => {
    const slug = await setupWinProOrg('no-likelihood-filter')
    const findPeopleSpy = spyOnFindPeople()

    await service.client.post(
      '/v1/contacts/count',
      { genderFemale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const dto = findPeopleSpy.mock.calls[0]?.[0]
    expect(dto?.idOverrides).toBeUndefined()
    expect(dto?.filters.filterOperators.voterStatus).toBeUndefined()
  })

  it('is a no-op for a Serve (eo-) org — no override lookup, even with an override row present', async () => {
    const slug = await setupEoOrg('serve-skip')
    const personId = randomUUID()
    // A voter_likelihood row should never exist for an eo- org in production
    // (the write path 400s for eo- orgs) — seeding one anyway proves the
    // filter path is skipped by construction (hasElectedOfficeAccess), not
    // merely because no row exists.
    await setOverride(slug, personId, 'super')
    const findPeopleSpy = spyOnFindPeople()

    await service.client.post(
      '/v1/contacts/count',
      { audienceSuperVoters: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    const dto = findPeopleSpy.mock.calls[0]?.[0]
    expect(dto?.idOverrides).toBeUndefined()
    expect(dto?.filters.filterOperators.voterStatus).toEqual({
      operator: 'eq',
      value: 'Super',
    })
  })
})
