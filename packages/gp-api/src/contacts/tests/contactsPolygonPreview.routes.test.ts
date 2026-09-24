import { randomUUID } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import {
  DoorKnockingEvaluateResponse,
  GeoJsonPolygon,
  GeoJsonShape,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { VoterDoorKnockingService } from '@/peopleDb/services/voterDoorKnocking.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// A one-degree square around (0, 0). Every case below picks its points
// relative to this ring, so "inside the bbox, outside the ring" stays
// meaningful without a second polygon.
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

// An L with the top-right quadrant cut out. Its bbox is still the unit
// square, so a point at (0.9, 0.9) is inside the bbox and outside the ring —
// the exact case the ray-cast exists to catch and the bbox prefilter cannot.
const NOTCHED: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 0.5],
      [0.5, 0.5],
      [0.5, 1],
      [0, 1],
      [0, 0],
    ],
  ],
}

// Two parts that share the strip 0.5 <= lng <= 1. A person standing in that
// strip is inside BOTH, which is the case the count has to collapse.
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

// Two parts with a gap between them, so each part's own bbox is tight and
// neither contains the other's people.
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

const person = (lng: number, lat: number) => ({
  id: randomUUID(),
  firstName: 'Ada',
  lastName: 'Lovelace',
  lat,
  lng,
  addressKey: `${lng}|${lat}`,
  displayAddress: '1 Main St',
})

// The draw step's live count. Every case drives the route through the real
// HTTP pipeline (auth, org resolution, Pro gate, district gate, filter
// resolution) against a real Postgres database; only the people-db bbox
// query is stubbed.
describe('POST /v1/contacts/polygon-preview', () => {
  // `eo-` orgs are Serve/elected-office and license-equivalent to Pro
  // (hasElectedOfficeAccess), so this fixture is Pro without a Campaign row.
  const setupServeOrg = async (
    suffix: string,
    data: { overrideDistrictId?: string } = {
      overrideDistrictId: randomUUID(),
    },
  ) => {
    const slug = `eo-polygon-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id, ...data },
    })
    return slug
  }

  const spyOnEvaluate = (people: DoorKnockingEvaluateResponse['people']) =>
    vi
      .spyOn(service.app.get(VoterDoorKnockingService), 'evaluate')
      .mockResolvedValue({ people })

  const preview = (
    slug: string,
    body: { geoPoly: GeoJsonShape; filters: Record<string, unknown> },
  ) =>
    service.client.post('/v1/contacts/polygon-preview', body, {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

  it('403s for a non-pro organization without querying people-db', async () => {
    const slug = `campaign-polygon-nonpro-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const evaluateSpy = spyOnEvaluate([])

    const response = await preview(slug, {
      geoPoly: SQUARE,
      filters: { genderMale: true },
    })

    expect(response.status).toBe(403)
    expect(evaluateSpy).not.toHaveBeenCalled()
  })

  it('400s with VOTER_DATA_UNAVAILABLE when the org resolves no district', async () => {
    const slug = await setupServeOrg('no-district', {})
    const evaluateSpy = spyOnEvaluate([])

    const response = await preview(slug, {
      geoPoly: SQUARE,
      filters: { genderMale: true },
    })

    expect(response.status).toBe(400)
    expect(response.data).toEqual(
      expect.objectContaining({ errorCode: 'VOTER_DATA_UNAVAILABLE' }),
    )
    expect(evaluateSpy).not.toHaveBeenCalled()
  })

  it('400s on a party filter for an elected-office organization', async () => {
    const slug = await setupServeOrg('party')
    const evaluateSpy = spyOnEvaluate([])

    const response = await preview(slug, {
      geoPoly: SQUARE,
      filters: { partyDemocrat: true },
    })

    expect(response.status).toBe(400)
    expect(evaluateSpy).not.toHaveBeenCalled()
  })

  it('flags audienceEmpty when the filters themselves match nobody', async () => {
    const slug = await setupServeOrg('audience-empty')
    const evaluateSpy = spyOnEvaluate([person(0.5, 0.5)])

    // No ContactInteractionDoorKnock rows exist for a fresh org, so this
    // activity condition resolves to the empty person-id set.
    const response = await preview(slug, {
      geoPoly: SQUARE,
      filters: {
        activityConditions: [{ outreachType: 'doorKnocking', actions: [] }],
      },
    })

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 0, audienceEmpty: true })
    expect(evaluateSpy).not.toHaveBeenCalled()
  })

  // Emptiness is decided locally and needs no district, so the two gates are
  // independent — and an org can trip both. Answering with the district error
  // here would report a missing office as a missing audience, which sends the
  // user to support over a shape they could simply move.
  it('flags audienceEmpty even when the org resolves no district', async () => {
    const slug = await setupServeOrg('empty-no-district', {})
    const evaluateSpy = spyOnEvaluate([person(0.5, 0.5)])

    const response = await preview(slug, {
      geoPoly: SQUARE,
      filters: {
        activityConditions: [{ outreachType: 'doorKnocking', actions: [] }],
      },
    })

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 0, audienceEmpty: true })
    expect(evaluateSpy).not.toHaveBeenCalled()
  })

  // The other zero: the audience exists, the shape just does not hold any of
  // it. A caller that cannot tell these apart tells the holder to fix the
  // wrong thing.
  it('returns a plain zero, not audienceEmpty, when the shape encloses nobody', async () => {
    const slug = await setupServeOrg('encloses-nobody')
    spyOnEvaluate([])

    const response = await preview(slug, {
      geoPoly: SQUARE,
      filters: { genderMale: true },
    })

    expect(response.status).toBe(201)
    expect(response.data).toMatchObject({ count: 0, audienceEmpty: false })
  })

  // The bbox query rejects rather than truncates past its cap, so the
  // alternative to a clear refusal is a confidently wrong number.
  it('refuses an oversized area in contacts language, not turf language', async () => {
    const slug = await setupServeOrg('over-cap')
    vi.spyOn(
      service.app.get(VoterDoorKnockingService),
      'evaluate',
    ).mockRejectedValue(
      new BadRequestException(
        'Turf evaluation matched more than 50000 people — shrink the ' +
          'polygon or narrow the filters',
      ),
    )

    const response = await preview(slug, {
      geoPoly: SQUARE,
      filters: { genderMale: true },
    })

    expect(response.status).toBe(400)
    expect(response.data.message).toContain('Draw a smaller boundary')
    expect(response.data.message).not.toContain('Turf')
  })

  // Each part is scanned against its OWN box, not one box around the whole
  // shape. With parts this far apart a single union box would be 11 degrees
  // on a side and drag most of a state through the evaluate cap.
  it('scans one tight bbox per part rather than one around them all', async () => {
    const slug = await setupServeOrg('fan-out')
    const evaluateSpy = vi
      .spyOn(service.app.get(VoterDoorKnockingService), 'evaluate')
      .mockResolvedValueOnce({ people: [person(0.5, 0.5)] })
      .mockResolvedValueOnce({ people: [person(10.5, 10.5)] })

    const response = await preview(slug, {
      geoPoly: DISJOINT_PAIR,
      filters: { genderMale: true },
    })

    expect(response.status).toBe(201)
    expect(response.data).toMatchObject({ count: 2, audienceEmpty: false })
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
  })

  // The whole reason parts are allowed to overlap. Both parts' bbox queries
  // return this person, and the count has to be 1 — a plain sum would say 2
  // and the holder would be told their list is twice the size it is.
  it('counts a person in two overlapping parts exactly once', async () => {
    const slug = await setupServeOrg('dedup')
    // One record, returned by both scans, as people-db would: the strip
    // 0.5..1 is inside both parts and so inside both boxes.
    const shared = person(0.75, 0.5)
    const evaluateSpy = vi
      .spyOn(service.app.get(VoterDoorKnockingService), 'evaluate')
      .mockResolvedValue({ people: [shared] })

    const response = await preview(slug, {
      geoPoly: OVERLAPPING_PAIR,
      filters: { genderMale: true },
    })

    expect(response.status).toBe(201)
    expect(response.data).toMatchObject({ count: 1, audienceEmpty: false })
    expect(evaluateSpy).toHaveBeenCalledTimes(2)
  })

  // The cap can be reached by any part, not just the first. A loop that
  // swallowed a later rejection would answer with a partial count that looks
  // exactly like a real one.
  it('surfaces the cap refusal when a LATER part is the one over it', async () => {
    const slug = await setupServeOrg('over-cap-second-part')
    vi.spyOn(service.app.get(VoterDoorKnockingService), 'evaluate')
      .mockResolvedValueOnce({ people: [person(0.5, 0.5)] })
      .mockRejectedValueOnce(
        new BadRequestException(
          'Turf evaluation matched more than 50000 people — shrink the ' +
            'polygon or narrow the filters',
        ),
      )

    const response = await preview(slug, {
      geoPoly: DISJOINT_PAIR,
      filters: { genderMale: true },
    })

    expect(response.status).toBe(400)
    expect(response.data.message).toContain('Draw a smaller boundary')
    expect(response.data.message).not.toContain('Turf')
  })

  it('counts by the ring, not the bbox the query was given', async () => {
    const slug = await setupServeOrg('ray-cast')
    // (0.9, 0.9) sits in the notch: inside the bbox the query prefiltered
    // on, outside the polygon itself.
    const evaluateSpy = spyOnEvaluate([person(0.25, 0.25), person(0.9, 0.9)])

    const response = await preview(slug, {
      geoPoly: NOTCHED,
      filters: { genderMale: true },
    })

    expect(response.status).toBe(201)
    expect(response.data).toMatchObject({ count: 1, audienceEmpty: false })
    expect(evaluateSpy.mock.calls[0]?.[0]?.bbox).toEqual({
      minLng: 0,
      maxLng: 1,
      minLat: 0,
      maxLat: 1,
    })
  })
})
