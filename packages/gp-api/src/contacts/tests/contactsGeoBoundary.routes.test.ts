import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  DoorKnockingEvaluateResponse,
  GeoJsonPolygon,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { VoterDoorKnockingService } from '@/peopleDb/services/voterDoorKnocking.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

const SQUARE: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
}

const person = (id: string, lng: number, lat: number) => ({
  id,
  firstName: 'Ada',
  lastName: 'Lovelace',
  lat,
  lng,
  addressKey: `${lng}|${lat}`,
  displayAddress: '1 Main St',
})

// A saved boundary, from the write that freezes it to the reads that have to
// honour it. The people-db bbox query is the only stub; the filter row, its
// member rows and every resolution in between are real.
describe('saved list boundaries', () => {
  const setupServeOrg = async (suffix: string) => {
    const slug = `eo-geo-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  // Re-spying the same method returns the SAME spy, history included, so a
  // case that asserts on calls made after an earlier request has to clear it.
  const spyOnEvaluate = (people: DoorKnockingEvaluateResponse['people']) =>
    vi
      .spyOn(service.app.get(VoterDoorKnockingService), 'evaluate')
      .mockClear()
      .mockResolvedValue({ people })

  const createFilter = (slug: string, body: Record<string, unknown>) =>
    service.client.post('/v1/voters/voter-file/filter', body, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

  const updateFilter = (
    slug: string,
    id: number,
    body: Record<string, unknown>,
  ) =>
    service.client.put(`/v1/voters/voter-file/filter/${id}`, body, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

  const geoMemberIds = (voterFileFilterId: number) =>
    service.prisma.voterFileFilterGeoMember
      .findMany({ where: { voterFileFilterId }, select: { personId: true } })
      .then((rows) => rows.map((r) => r.personId).sort())

  it('freezes the enclosed people when a list is created with a boundary', async () => {
    const slug = await setupServeOrg('create')
    const inside = randomUUID()
    spyOnEvaluate([person(inside, 0.5, 0.5)])

    const response = await createFilter(slug, {
      name: 'Boundary list',
      genderFemale: true,
      geoPoly: SQUARE,
    })

    expect(response.status).toBe(201)
    expect(await geoMemberIds(response.data.id)).toEqual([inside])
    const row = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: response.data.id },
    })
    expect(row.geoPoly).toEqual(SQUARE)
    expect(row.geoMembersResolvedAt).toBeInstanceOf(Date)
  })

  // The scan runs unfiltered on purpose: the frozen set is the geographic
  // half of a list and the criteria re-apply on every read, so a later
  // filter edit cannot invalidate a boundary nobody moved.
  it('freezes everyone inside the shape, not only those matching the criteria', async () => {
    const slug = await setupServeOrg('unfiltered')
    const evaluateSpy = spyOnEvaluate([])

    await createFilter(slug, {
      name: 'Unfiltered scan',
      genderFemale: true,
      geoPoly: SQUARE,
    })

    // The DTO normalizes an absent filter set into its canonical empty
    // shape, so the assertion is "no criteria", not a literal `{}`.
    expect(evaluateSpy).toHaveBeenCalledTimes(1)
    expect(evaluateSpy.mock.calls[0]?.[0].filters).toMatchObject({
      filters: [],
      filterValues: {},
      filterOperators: {},
    })
  })

  // The contacts map draws every geocoded row, so counting rooftop-only
  // would freeze a different population than the one drawn around.
  it('scans without the door-knocking rooftop gate', async () => {
    const slug = await setupServeOrg('rooftop')
    const evaluateSpy = spyOnEvaluate([])

    await createFilter(slug, { name: 'Rooftop off', geoPoly: SQUARE })

    expect(evaluateSpy).toHaveBeenCalledWith(expect.anything(), {
      requireRooftopAccuracy: false,
    })
  })

  it('re-freezes the membership when a boundary is redrawn', async () => {
    const slug = await setupServeOrg('redraw')
    const first = randomUUID()
    spyOnEvaluate([person(first, 0.5, 0.5)])
    const created = await createFilter(slug, {
      name: 'Redrawn',
      geoPoly: SQUARE,
    })

    const second = randomUUID()
    spyOnEvaluate([person(second, 0.25, 0.25)])
    const updated = await updateFilter(slug, created.data.id, {
      geoPoly: SQUARE,
    })

    expect(updated.status).toBe(200)
    expect(await geoMemberIds(created.data.id)).toEqual([second])
  })

  // A shape removed with its rows left behind would keep narrowing the list
  // with nothing on the map to explain why.
  it('clears the shape, its membership and its stamp together', async () => {
    const slug = await setupServeOrg('clear')
    spyOnEvaluate([person(randomUUID(), 0.5, 0.5)])
    const created = await createFilter(slug, {
      name: 'To clear',
      geoPoly: SQUARE,
    })

    const cleared = await updateFilter(slug, created.data.id, {
      geoPoly: null,
    })

    expect(cleared.status).toBe(200)
    expect(await geoMemberIds(created.data.id)).toEqual([])
    const row = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: created.data.id },
    })
    expect(row.geoPoly).toBeNull()
    expect(row.geoMembersResolvedAt).toBeNull()
  })

  it('leaves an existing boundary alone when the update does not mention it', async () => {
    const slug = await setupServeOrg('untouched')
    const frozen = randomUUID()
    spyOnEvaluate([person(frozen, 0.5, 0.5)])
    const created = await createFilter(slug, {
      name: 'Untouched',
      geoPoly: SQUARE,
    })

    const evaluateSpy = spyOnEvaluate([])
    await updateFilter(slug, created.data.id, { name: 'Renamed only' })

    expect(evaluateSpy).not.toHaveBeenCalled()
    expect(await geoMemberIds(created.data.id)).toEqual([frozen])
  })

  // The worst failure this feature can have: a shape that caught nobody
  // reading as no constraint at all, and quietly serving the whole list.
  it('refuses to widen to the unrefined list when the shape caught nobody', async () => {
    const slug = await setupServeOrg('empty')
    spyOnEvaluate([])
    const created = await createFilter(slug, {
      name: 'Caught nobody',
      geoPoly: SQUARE,
    })

    expect(await geoMemberIds(created.data.id)).toEqual([])

    const listed = await service.client.get('/v1/contacts', {
      params: { segment: String(created.data.id), page: 1, resultsPerPage: 10 },
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(listed.status).toBe(200)
    expect(listed.data.people).toEqual([])
    expect(listed.data.pagination.totalResults).toBe(0)
  })

  it('409s a boundary write on a list already used for outreach', async () => {
    const slug = await setupServeOrg('locked')
    spyOnEvaluate([person(randomUUID(), 0.5, 0.5)])
    const created = await createFilter(slug, { name: 'Locked' })

    await service.prisma.voterFileFilter.update({
      where: { id: created.data.id },
      data: { firstUsedForOutreachAt: new Date() },
    })

    const response = await updateFilter(slug, created.data.id, {
      geoPoly: SQUARE,
    })

    expect(response.status).toBe(409)
  })
})
