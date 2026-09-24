import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import {
  DoorKnockingEvaluateResponse,
  GeoJsonPolygon,
  GeoJsonShape,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { VoterDoorKnockingService } from '@/peopleDb/services/voterDoorKnocking.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

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

// Two parts with a gap between them, so each part's own box is tight and
// neither holds the other's people.
const DISJOINT_PAIR: GeoJsonShape = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
    [
      [
        [10, 10],
        [11, 10],
        [11, 11],
        [10, 11],
        [10, 10],
      ],
    ],
  ],
}

// Two parts sharing the strip 0.5 <= lng <= 1, so a person standing there
// is inside both and is returned by both scans.
const OVERLAPPING_PAIR: GeoJsonShape = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
    [
      [
        [0.5, 0],
        [1.5, 0],
        [1.5, 1],
        [0.5, 1],
        [0.5, 0],
      ],
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

  // The scan that freezes a shape's membership is a full Databricks bbox
  // read, and it was the one such read on this service with no Pro gate:
  // `filterAccessCheck` on the route above only throws for a non-Pro
  // `campaign-` slug, so an org whose slug is neither `campaign-` nor `eo-`
  // passed it and reached the warehouse.
  it('refuses to freeze a boundary for an organization without pro access', async () => {
    const slug = `org-geo-nonpro-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    const evaluateSpy = spyOnEvaluate([person(randomUUID(), 0.5, 0.5)])

    const response = await createFilter(slug, {
      name: 'Boundary list',
      genderFemale: true,
      geoPoly: SQUARE,
    })

    expect(response.status).toBe(403)
    expect(evaluateSpy).not.toHaveBeenCalled()
  })

  // The edit wizard counts a saved list by spreading its fields inline, and
  // an inline filter carries neither an id nor a geoPoly — so the boundary
  // was invisible to it and "Save changes (5,356)" sat one click from a list
  // whose own detail sheet read 339. `boundaryFromSegmentId` is how the
  // count goes and finds the shape it is not being given.
  describe('counting a list that carries a boundary', () => {
    const spyOnFindPeople = () =>
      vi
        .spyOn(service.app.get(VoterQueryService), 'findPeople')
        .mockClear()
        .mockResolvedValue({
          people: [],
          pagination: {
            totalResults: 0,
            currentPage: 1,
            pageSize: 1,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        } as never)

    const countWith = (slug: string, body: Record<string, unknown>) =>
      service.client.post('/v1/contacts/count', body, {
        headers: { [ORG_SLUG_HEADER]: slug },
      })

    const seedBoundariedList = async (suffix: string) => {
      const slug = await setupServeOrg(suffix)
      const inside = randomUUID()
      spyOnEvaluate([person(inside, 0.5, 0.5)])
      const created = await createFilter(slug, {
        name: 'Boundary list',
        genderFemale: true,
        geoPoly: SQUARE,
      })
      return { slug, listId: created.data.id as number, inside }
    }

    it('narrows the count to the frozen members when given the list id', async () => {
      const { slug, listId, inside } = await seedBoundariedList('count-with')
      const findPeople = spyOnFindPeople()

      const response = await countWith(slug, {
        genderFemale: true,
        boundaryFromSegmentId: listId,
      })

      expect(response.status).toBe(201)
      expect(findPeople.mock.calls[0]?.[0]?.filters).toMatchObject({
        filterOperators: { id: { operator: 'in', values: [inside] } },
      })
    })

    // The other half of the same assertion: without the id the count is the
    // pre-boundary one. Pinned so the fix cannot be quietly reverted into
    // "it was always narrowed anyway".
    it('does not narrow when the list id is absent', async () => {
      const { slug } = await seedBoundariedList('count-without')
      const findPeople = spyOnFindPeople()

      await countWith(slug, { genderFemale: true })

      expect(findPeople.mock.calls[0]?.[0]?.filters?.filters).not.toContain(
        'id',
      )
    })

    // A bare id off the wire, so it is resolved through the org-scoped
    // segment lookup rather than trusted.
    it('refuses a list id belonging to another organization', async () => {
      const { listId } = await seedBoundariedList('count-owner')
      const otherSlug = await setupServeOrg('count-other')
      const findPeople = spyOnFindPeople()

      const response = await countWith(otherSlug, {
        genderFemale: true,
        boundaryFromSegmentId: listId,
      })

      expect(response.status).toBe(404)
      expect(findPeople).not.toHaveBeenCalled()
    })
  })

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
  // The freeze path is its OWN implementation — its own part loop, its own
  // Set, its own evaluate call — so the preview's multi-part tests say
  // nothing about it. These three cover the same ground on this side.
  it('freezes a multi-part boundary by scanning each part on its own box', async () => {
    const slug = await setupServeOrg('multi-create')
    const first = randomUUID()
    const second = randomUUID()
    const evaluateSpy = vi
      .spyOn(service.app.get(VoterDoorKnockingService), 'evaluate')
      .mockClear()
      .mockResolvedValueOnce({ people: [person(first, 0.5, 0.5)] })
      .mockResolvedValueOnce({ people: [person(second, 10.5, 10.5)] })

    const response = await createFilter(slug, {
      name: 'Two neighbourhoods',
      genderFemale: true,
      geoPoly: DISJOINT_PAIR,
    })

    expect(response.status).toBe(201)
    expect(evaluateSpy).toHaveBeenCalledTimes(2)
    expect(evaluateSpy.mock.calls[0]?.[0]?.bbox).toEqual({
      minLng: 0,
      maxLng: 1,
      minLat: 0,
      maxLat: 1,
    })
    expect(evaluateSpy.mock.calls[1]?.[0]?.bbox).toEqual({
      minLng: 10,
      maxLng: 11,
      minLat: 10,
      maxLat: 11,
    })
    expect(await geoMemberIds(response.data.id)).toEqual([first, second].sort())
    const row = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: response.data.id },
    })
    expect(row.geoPoly).toEqual(DISJOINT_PAIR)
  })

  // The reason parts are allowed to overlap at all. One person, returned by
  // both parts' scans, must be one member row — the unique constraint would
  // survive a duplicate, but the COUNT the holder is shown would not.
  it('writes one member row for a person standing in two parts', async () => {
    const slug = await setupServeOrg('multi-dedup')
    const shared = randomUUID()
    const evaluateSpy = spyOnEvaluate([person(shared, 0.75, 0.5)])

    const response = await createFilter(slug, {
      name: 'Overlapping parts',
      genderFemale: true,
      geoPoly: OVERLAPPING_PAIR,
    })

    expect(response.status).toBe(201)
    expect(evaluateSpy).toHaveBeenCalledTimes(2)
    expect(await geoMemberIds(response.data.id)).toEqual([shared])
  })

  // The cap can be reached by any part. A loop that swallowed a later
  // rejection would save a boundary whose frozen membership is a partial
  // scan, and nothing afterwards could tell it from a complete one.
  it('fails the whole save when a LATER part is over the cap', async () => {
    const slug = await setupServeOrg('multi-cap')
    vi.spyOn(service.app.get(VoterDoorKnockingService), 'evaluate')
      .mockClear()
      .mockResolvedValueOnce({ people: [person(randomUUID(), 0.5, 0.5)] })
      .mockRejectedValueOnce(
        new BadRequestException(
          'Turf evaluation matched more than 50000 people — shrink the ' +
            'polygon or narrow the filters',
        ),
      )

    const response = await createFilter(slug, {
      name: 'Too big in part two',
      genderFemale: true,
      geoPoly: DISJOINT_PAIR,
    })

    expect(response.status).toBe(400)
    // Nothing half-written: no filter row survives a refused freeze.
    const rows = await service.prisma.voterFileFilter.findMany({
      where: { organizationSlug: slug },
    })
    expect(rows).toEqual([])
  })

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
