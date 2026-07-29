import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PinoLogger } from 'nestjs-pino'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// ENG-10840: the saved-list overlap-count route. Every case below drives the
// route through the real HTTP pipeline (auth, org resolution, Pro gate,
// saved-filter loading, activity-condition resolution) with a real Postgres
// database; only the people-api S2S call itself is stubbed.
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
        overrideDistrictId: `district-overlap-${suffix}`,
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

  const spyOnPeopleApi = (data: Record<string, unknown>) =>
    vi
      .spyOn(service.app.get(HttpService), 'post')
      .mockReturnValue(of({ data }) as never)

  it('400s for a non-pro organization without calling people-api', async () => {
    const slug = `campaign-overlap-nonpro-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const postSpy = spyOnPeopleApi({ count: 0, fenced: false })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { genderMale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(400)
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('returns zero without calling people-api when the org has no saved lists', async () => {
    const slug = await setupProOrg('no-lists')
    const postSpy = spyOnPeopleApi({ count: 5, fenced: false })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { genderMale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 0, fenced: false })
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('returns zero without calling people-api when the current selection resolves to nobody', async () => {
    const slug = await setupProOrg('empty-selection')
    await createSavedFilter(slug, { genderFemale: true })
    const postSpy = spyOnPeopleApi({ count: 5, fenced: false })

    // No ContactInteractionDoorKnock rows exist for a fresh org, so this
    // activity condition resolves to the empty person-id set.
    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { activityConditions: [{ outreachType: 'doorKnocking', actions: [] }] },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 0, fenced: false })
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('resolves the saved lists and forwards a base-selection + saved-set-union payload', async () => {
    const slug = await setupProOrg('resolves')
    await createSavedFilter(slug, { name: 'A', genderFemale: true })
    await createSavedFilter(slug, { name: 'B', genderMale: true })
    const postSpy = spyOnPeopleApi({ count: 7, fenced: false })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { ageUnknown: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 7, fenced: false })
    expect(postSpy).toHaveBeenCalledTimes(1)

    const [url, body] = postSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(url).toContain('/v1/people/overlap-count')
    expect(body.filters).toEqual(
      expect.objectContaining({ ageInt: { is: 'null' } }),
    )
    expect(body.savedFilterSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gender: { eq: 'F' } }),
        expect.objectContaining({ gender: { eq: 'M' } }),
      ]),
    )
    expect((body.savedFilterSets as unknown[]).length).toBe(2)
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
    const postSpy = spyOnPeopleApi({ count: 1, fenced: false })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { genderMale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(postSpy).toHaveBeenCalledTimes(1)
    const body = postSpy.mock.calls[0]?.[1] as Record<string, unknown>
    expect((body.savedFilterSets as unknown[]).length).toBe(1)
  })

  it('caps at the 25 most-recently-saved lists and logs a truncation warning', async () => {
    const slug = await setupProOrg('cap')
    const warnSpy = vi.spyOn(PinoLogger.prototype, 'warn')
    for (let i = 0; i < 26; i++) {
      await createSavedFilter(slug, { name: `list-${i}`, genderFemale: true })
    }
    const postSpy = spyOnPeopleApi({ count: 2, fenced: false })

    const response = await service.client.post(
      '/v1/contacts/overlap-count',
      { genderMale: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(postSpy).toHaveBeenCalledTimes(1)
    const body = postSpy.mock.calls[0]?.[1] as Record<string, unknown>
    expect((body.savedFilterSets as unknown[]).length).toBe(25)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ total: 26, cap: 25 }),
      expect.stringContaining('truncated'),
    )
  })
})
