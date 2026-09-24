import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { DoorKnockingEvaluateResponse } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { VoterDoorKnockingService } from '@/peopleDb/services/voterDoorKnocking.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

const person = (lng: number, lat: number) => ({
  id: randomUUID(),
  firstName: 'Ada',
  lastName: 'Lovelace',
  lat,
  lng,
  addressKey: `${lng}|${lat}`,
  displayAddress: '1 Main St',
})

// The dots the draw step draws on. Same gates as its polygon-preview
// sibling, asked of the whole district rather than of a shape — the map has
// to show the list before there is a shape to narrow it with.
describe('POST /v1/contacts/points', () => {
  const setupServeOrg = async (
    suffix: string,
    data: { overrideDistrictId?: string } = {
      overrideDistrictId: randomUUID(),
    },
  ) => {
    const slug = `eo-points-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id, ...data },
    })
    return slug
  }

  const spyOnEvaluatePoints = (
    people: DoorKnockingEvaluateResponse['people'],
    truncated = false,
  ) =>
    vi
      .spyOn(service.app.get(VoterDoorKnockingService), 'evaluatePoints')
      .mockResolvedValue({ people, truncated })

  const points = (slug: string, filters: Record<string, unknown>) =>
    service.client.post(
      '/v1/contacts/points',
      { filters },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

  it('403s for a non-pro organization without querying people-db', async () => {
    const slug = `campaign-points-nonpro-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const spy = spyOnEvaluatePoints([])

    const response = await points(slug, { genderMale: true })

    expect(response.status).toBe(403)
    expect(spy).not.toHaveBeenCalled()
  })

  it('400s with VOTER_DATA_UNAVAILABLE when the org resolves no district', async () => {
    const slug = await setupServeOrg('no-district', {})
    const spy = spyOnEvaluatePoints([])

    const response = await points(slug, { genderMale: true })

    expect(response.status).toBe(400)
    expect(response.data).toEqual(
      expect.objectContaining({ errorCode: 'VOTER_DATA_UNAVAILABLE' }),
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('400s on a party filter for an elected-office organization', async () => {
    const slug = await setupServeOrg('party')
    const spy = spyOnEvaluatePoints([])

    const response = await points(slug, { partyDemocrat: true })

    expect(response.status).toBe(400)
    expect(spy).not.toHaveBeenCalled()
  })

  // Filters that match nobody are an empty map, not an error and not a
  // warehouse round trip — the same short circuit polygon-preview takes, and
  // like that one it is decided before the district gate.
  it('returns no points, without querying, when the filters match nobody', async () => {
    const slug = await setupServeOrg('audience-empty')
    const spy = spyOnEvaluatePoints([person(0.5, 0.5)])

    const response = await points(slug, {
      activityConditions: [{ outreachType: 'doorKnocking', actions: [] }],
    })

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ points: [], truncated: false })
    expect(spy).not.toHaveBeenCalled()
  })

  // The whole reason this endpoint exists. The step used to draw the
  // district's entire universe under a pill counting only the filtered
  // audience, so a shape around visible dots returned fewer people than it
  // enclosed. A filter reaching the query is what keeps the two in step.
  it('carries the draft filters into the query', async () => {
    const slug = await setupServeOrg('filters-applied')
    const spy = spyOnEvaluatePoints([person(0.5, 0.5)])

    const response = await points(slug, { genderFemale: true })

    expect(response.status).toBe(201)
    const sentFilters = spy.mock.calls[0]?.[0]?.filters
    expect(JSON.stringify(sentFilters)).toContain('gender')
  })

  // Names and addresses are deliberately absent: the step has no person
  // overlay behind its dots, and this is the widest read in the CRM.
  it('returns bare coordinates and no personal detail', async () => {
    const slug = await setupServeOrg('coords-only')
    const someone = person(-85.62, 44.76)
    spyOnEvaluatePoints([someone])

    const response = await points(slug, { genderMale: true })

    expect(response.status).toBe(201)
    expect(response.data.points).toEqual([
      { id: someone.id, lat: 44.76, lng: -85.62 },
    ])
    expect(JSON.stringify(response.data)).not.toContain('Lovelace')
  })

  // No shape yet, so nothing to prefilter for. A bbox drawn around anything
  // smaller than the world would silently drop the dots outside it.
  it('asks for the whole district, not a sub-area of it', async () => {
    const slug = await setupServeOrg('world-bbox')
    const spy = spyOnEvaluatePoints([])

    await points(slug, { genderMale: true })

    expect(spy.mock.calls[0]?.[0]?.bbox).toEqual({
      minLat: -90,
      maxLat: 90,
      minLng: -180,
      maxLng: 180,
    })
  })

  // The rooftop gate is door knocking's routing rule. With it on, the map
  // would draw fewer dots than polygon-preview counts, which is the bug this
  // whole surface was built out of.
  it('drops the rooftop accuracy gate', async () => {
    const slug = await setupServeOrg('no-rooftop')
    const spy = spyOnEvaluatePoints([])

    await points(slug, { genderMale: true })

    expect(spy.mock.calls[0]?.[1]).toEqual({ requireRooftopAccuracy: false })
  })

  it('passes the truncation flag through rather than swallowing it', async () => {
    const slug = await setupServeOrg('truncated')
    spyOnEvaluatePoints([person(0.5, 0.5)], true)

    const response = await points(slug, { genderMale: true })

    expect(response.status).toBe(201)
    expect(response.data.truncated).toBe(true)
  })
})
