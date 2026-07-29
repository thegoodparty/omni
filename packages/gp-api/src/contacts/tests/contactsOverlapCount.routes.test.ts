import { randomUUID } from 'node:crypto'
import { HttpService } from '@nestjs/axios'
import { BadRequestException } from '@nestjs/common'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PinoLogger } from 'nestjs-pino'
import { ActivityConditionResolutionService } from 'src/contactInteraction/services/activityConditionResolution.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// ENG-10840: the saved-list overlap-count route. Every case below drives the
// route through the real HTTP pipeline (auth, org resolution, Pro gate,
// saved-filter loading, activity-condition resolution) with a real Postgres
// database; only the in-process people-db overlap query itself is stubbed.
describe('POST /v1/contacts/overlap-count', () => {
  // `eo-` orgs are Serve/elected-office and license-equivalent to Pro
  // (hasElectedOfficeAccess), so this fixture is Pro without needing a
  // Campaign row.
  const setupProOrg = async (suffix: string) => {
    const slug = `eo-overlap-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  const createSavedFilter = (
    organizationSlug: string,
    overrides: Record<string, unknown> = {},
  ) =>
    service.prisma.voterFileFilter.create({
      data: { organizationSlug, name: 'saved list', ...overrides },
    })

  // A Win (non-`eo-`) Pro org: needs its own Campaign row (isPro) since
  // hasElectedOfficeAccess only covers `eo-` slugs, plus overrideDistrictId
  // so district resolution doesn't need real election data.
  const setupWinProOrg = async (suffix: string) => {
    const slug = `campaign-overlap-${suffix}-${Date.now()}`
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

  const spyOnOverlapCount = (data: { count: number; fenced: boolean }) =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'getOverlapCount')
      .mockResolvedValue(data)

  it('400s for a non-pro organization without querying people-db', async () => {
    const slug = `campaign-overlap-nonpro-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const overlapSpy = spyOnOverlapCount({ count: 0, fenced: false })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { genderMale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(400)
    expect(overlapSpy).not.toHaveBeenCalled()
  })

  it('returns zero without querying people-db when the org has no saved lists', async () => {
    const slug = await setupProOrg('no-lists')
    const overlapSpy = spyOnOverlapCount({ count: 5, fenced: false })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { genderMale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 0, fenced: false })
    expect(overlapSpy).not.toHaveBeenCalled()
  })

  it('returns zero without querying people-db when the current selection resolves to nobody', async () => {
    const slug = await setupProOrg('empty-selection')
    await createSavedFilter(slug, { genderFemale: true })
    const overlapSpy = spyOnOverlapCount({ count: 5, fenced: false })

    // No ContactInteractionDoorKnock rows exist for a fresh org, so this
    // activity condition resolves to the empty person-id set.
    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { activityConditions: [{ outreachType: 'doorKnocking', actions: [] }] },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 0, fenced: false })
    expect(overlapSpy).not.toHaveBeenCalled()
  })

  it('resolves the saved lists and forwards a base-selection + saved-set-union payload', async () => {
    const slug = await setupProOrg('resolves')
    await createSavedFilter(slug, { name: 'A', genderFemale: true })
    await createSavedFilter(slug, { name: 'B', genderMale: true })
    const overlapSpy = spyOnOverlapCount({ count: 7, fenced: false })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { ageUnknown: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 7, fenced: false })
    expect(overlapSpy).toHaveBeenCalledTimes(1)

    const dto = overlapSpy.mock.calls[0]?.[0]
    expect(dto?.filters.filterOperators).toEqual(
      expect.objectContaining({ ageInt: { operator: 'is', value: 'null' } }),
    )
    const genderOps = (dto?.savedFilterSets ?? []).map(
      (set) => set.filterOperators.gender,
    )
    expect(genderOps).toEqual(
      expect.arrayContaining([
        { operator: 'eq', value: 'F' },
        { operator: 'eq', value: 'M' },
      ]),
    )
    expect(dto?.savedFilterSets).toHaveLength(2)
  })

  it('drops a saved list whose own resolution matches nobody from the union', async () => {
    const slug = await setupProOrg('empty-saved-set')
    await createSavedFilter(slug, { name: 'real', genderFemale: true })
    // No door-knock interactions exist for this org, so this saved list's
    // activity condition resolves to the empty set — it should contribute
    // nothing to the union rather than sending a meaningless filter set.
    await createSavedFilter(slug, {
      name: 'orphaned-activity',
      activityConditions: {
        create: { outreachType: 'doorKnocking', actions: [] },
      },
    })
    const overlapSpy = spyOnOverlapCount({ count: 1, fenced: false })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { genderMale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(overlapSpy).toHaveBeenCalledTimes(1)
    expect(overlapSpy.mock.calls[0]?.[0]?.savedFilterSets).toHaveLength(1)
  })

  // resolveIdFilter 400s when a resolution exceeds MAX_RESOLVED_ID_SET_SIZE
  // (100k). One oversized saved list must be dropped from the union, not
  // abort the whole overlap count.
  it('drops a saved list whose resolved id set exceeds the cap instead of failing the count', async () => {
    const slug = await setupProOrg('cap-exceeded')
    await createSavedFilter(slug, { name: 'small', genderFemale: true })
    await createSavedFilter(slug, {
      name: 'huge',
      activityConditions: {
        create: { outreachType: 'doorKnocking', actions: [] },
      },
    })
    const resolution = service.app.get(ActivityConditionResolutionService)
    const realResolve = resolution.resolveIdFilter.bind(resolution)
    vi.spyOn(resolution, 'resolveIdFilter').mockImplementation(
      (organizationSlug, input) =>
        input.activityConditions?.length
          ? Promise.reject(
              new BadRequestException(
                'Activity filter matches too many contacts',
              ),
            )
          : realResolve(organizationSlug, input),
    )
    const warnSpy = vi.spyOn(PinoLogger.prototype, 'warn')
    const overlapSpy = spyOnOverlapCount({ count: 6, fenced: false })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { genderMale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 6, fenced: false })
    expect(overlapSpy).toHaveBeenCalledTimes(1)
    expect(overlapSpy.mock.calls[0]?.[0]?.savedFilterSets).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationSlug: slug }),
      expect.stringContaining('failed id-filter resolution'),
    )
  })

  it('caps at the 25 most-recently-saved lists and logs a truncation warning', async () => {
    const slug = await setupProOrg('cap')
    const warnSpy = vi.spyOn(PinoLogger.prototype, 'warn')
    for (let i = 0; i < 26; i++) {
      await createSavedFilter(slug, { name: `list-${i}`, genderFemale: true })
    }
    const overlapSpy = spyOnOverlapCount({ count: 2, fenced: false })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { genderMale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(overlapSpy).toHaveBeenCalledTimes(1)
    expect(overlapSpy.mock.calls[0]?.[0]?.savedFilterSets).toHaveLength(25)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ total: 26, cap: 25 }),
      expect.stringContaining('truncated'),
    )
  })

  // Security regression (party never reaches Serve, ENG-10696): the
  // voter-file create/update endpoints don't assert
  // assertNoPartyFilterForElectedOffice, so a legacy or otherwise-tainted
  // `eo-` saved list can still carry a party predicate. resolveSavedFilterSets
  // must drop that one saved set from the union rather than forwarding
  // `politicalParty` in savedFilterSets.
  it('drops a party-tainted saved list from the union for an elected-office org', async () => {
    const slug = await setupProOrg('party-tainted')
    await createSavedFilter(slug, { name: 'clean', genderFemale: true })
    // Simulates a legacy row that predates any write-path party gate — the
    // create/update endpoints don't reject this today.
    await createSavedFilter(slug, { name: 'tainted', partyDemocrat: true })
    const warnSpy = vi.spyOn(PinoLogger.prototype, 'warn')
    const overlapSpy = spyOnOverlapCount({ count: 3, fenced: false })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { genderMale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(overlapSpy).toHaveBeenCalledTimes(1)
    const savedFilterSets = overlapSpy.mock.calls[0]?.[0]?.savedFilterSets ?? []

    // Only the clean set survives; the tainted one never reaches the query at
    // all — not stripped down to `{}`, entirely excluded.
    expect(savedFilterSets).toHaveLength(1)
    expect(savedFilterSets[0]?.filterOperators.gender).toEqual({
      operator: 'eq',
      value: 'F',
    })
    expect(
      savedFilterSets.some((set) => 'politicalParty' in set.filterOperators),
    ).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationSlug: slug }),
      expect.stringContaining('party predicate'),
    )
  })

  it('still includes a Win org saved list carrying a party predicate in the union', async () => {
    const slug = await setupWinProOrg('party-allowed')
    await createSavedFilter(slug, { name: 'party list', partyDemocrat: true })
    const overlapSpy = spyOnOverlapCount({ count: 4, fenced: false })
    // A non-`eo-` org runs the voter-data-eligibility gate before district
    // resolution (assertVoterDataEligibility), which fetches the
    // overrideDistrictId from election-api over the shared HttpService — stub
    // it with L2 data present so the Win Pro org is eligible.
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

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { genderMale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(overlapSpy).toHaveBeenCalledTimes(1)
    const savedFilterSets = overlapSpy.mock.calls[0]?.[0]?.savedFilterSets ?? []

    expect(savedFilterSets).toHaveLength(1)
    expect(savedFilterSets[0]?.filterOperators.politicalParty).toEqual({
      operator: 'eq',
      value: 'Democratic',
    })
  })
})
