import { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import {
  Campaign,
  OutreachStatus,
  OutreachType,
  VoterFileFilter,
} from '../../generated/prisma'

const service = useTestService()

const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'

// A triangle, not a rectangle: its bbox has corners OUTSIDE the polygon, so
// the tests can prove the ray-cast drops bbox-only people.
const GEO_POLY = {
  type: 'Polygon',
  coordinates: [
    [
      [-87.66, 41.89],
      [-87.64, 41.89],
      [-87.65, 41.91],
      [-87.66, 41.89],
    ],
  ],
}

const person = (
  index: number,
  lat: number,
  lng: number,
  addressKey = `KEY-${index}`,
) => ({
  id: `${String(index).padStart(8, '0')}-1111-1111-1111-111111111111`,
  firstName: 'Voter',
  lastName: `Number${index}`,
  lat,
  lng,
  addressKey,
  displayAddress: `${index} W Elm St`,
})

// Three distinct coordinates inside the polygon, two people sharing one of
// them (dedupes to one stop), plus one person inside the bbox but OUTSIDE
// the polygon corner cut — the ray-cast must drop them.
const insidePeople = [
  person(1, 41.9, -87.65),
  person(2, 41.9, -87.65, 'KEY-1'),
  person(3, 41.901, -87.651),
  person(4, 41.902, -87.652),
]
const bboxOnlyPerson = person(9, 41.9, -87.6401)

// Geoapify visits the jobs in REVERSED id order so tests prove seq comes
// from the vendor plan, not from input order.
const geoapifyPlan = (body: { jobs: Array<{ id: string }> }) => {
  const ordered = [...body.jobs].reverse()
  return {
    features: [
      {
        properties: {
          time: 900,
          distance: 1200,
          actions: ordered.map((job) => ({ type: 'job', job_id: job.id })),
          legs: ordered.map((_, i) => ({ time: 60 + i, distance: 100 + i })),
        },
      },
    ],
  }
}

type PostBody = { jobs: Array<{ id: string }> }

const stubVendors = (
  overrides: {
    people?: Array<ReturnType<typeof person>>
    geoapify?: (body: PostBody) => unknown
  } = {},
) =>
  vi.spyOn(service.app.get(HttpService), 'post').mockImplementation(((
    url: string,
    body: PostBody,
  ) => {
    if (url.includes('/v1/door-knocking/evaluate')) {
      return of({
        data: {
          people: overrides.people ?? [...insidePeople, bboxOnlyPerson],
        },
      })
    }
    if (url.includes('routeplanner')) {
      const build = overrides.geoapify ?? geoapifyPlan
      return of({ data: build(body) })
    }
    return of({ data: {} })
  }) as never)

describe('door-knocking routes', () => {
  let campaign: Campaign
  let orgSlug: string
  let filter: VoterFileFilter

  beforeAll(() => {
    process.env.GEOAPIFY_API_KEY ??= 'test-key'
  })

  beforeEach(async () => {
    const suffix = Date.now()
    orgSlug = `campaign-dk-${suffix}`
    await service.prisma.organization.create({
      data: {
        slug: orgSlug,
        ownerId: service.user.id,
        overrideDistrictId: DISTRICT_ID,
      },
    })
    campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `dk-campaign-${suffix}`,
        organizationSlug: orgSlug,
      },
    })
    filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: orgSlug, name: 'DK audience' },
    })
  })

  const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

  const createTurf = async (name = 'Elm St turf') => {
    const res = await service.client.post(
      '/v1/door-knocking/turfs',
      {
        voterFileFilterId: filter.id,
        name,
        color: '#22aa55',
        geoPoly: GEO_POLY,
      },
      orgHeaders(),
    )
    expect(res.status).toBe(201)
    return res.data as { id: number; locked: boolean }
  }

  const knock = (turfId: number, body: Record<string, unknown> = {}) =>
    service.client.post(
      `/v1/door-knocking/turfs/${turfId}/knock`,
      { mode: 'walk', loop: false, ...body },
      { ...orgHeaders(), validateStatus: () => true },
    )

  describe('turf CRUD', () => {
    it('creates, lists, updates, and deletes a turf', async () => {
      const turf = await createTurf()
      expect(turf.locked).toBe(false)

      const list = await service.client.get(
        `/v1/door-knocking/turfs?voterFileFilterId=${filter.id}`,
        orgHeaders(),
      )
      expect(list.data).toHaveLength(1)

      const updated = await service.client.put(
        `/v1/door-knocking/turfs/${turf.id}`,
        { name: 'Renamed turf' },
        orgHeaders(),
      )
      expect(updated.data.name).toBe('Renamed turf')

      const del = await service.client.delete(
        `/v1/door-knocking/turfs/${turf.id}`,
        orgHeaders(),
      )
      expect(del.status).toBe(204)
    })

    it('rejects a turf on a filter owned by another organization', async () => {
      await service.prisma.organization.create({
        data: { slug: 'someone-else', ownerId: service.user.id },
      })
      const foreign = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: 'someone-else', name: 'not yours' },
      })
      const res = await service.client.post(
        '/v1/door-knocking/turfs',
        {
          voterFileFilterId: foreign.id,
          name: 'Nope',
          color: '#22aa55',
          geoPoly: GEO_POLY,
        },
        { ...orgHeaders(), validateStatus: () => true },
      )
      expect(res.status).toBe(404)
    })

    it('rejects a malformed polygon (unclosed ring)', async () => {
      const res = await service.client.post(
        '/v1/door-knocking/turfs',
        {
          voterFileFilterId: filter.id,
          name: 'Bad poly',
          color: '#22aa55',
          geoPoly: {
            type: 'Polygon',
            coordinates: [
              [
                [-87.66, 41.89],
                [-87.64, 41.89],
                [-87.64, 41.91],
                [-87.66, 41.91],
              ],
            ],
          },
        },
        { ...orgHeaders(), validateStatus: () => true },
      )
      expect(res.status).toBe(400)
    })
  })

  describe('knock', () => {
    it('freezes the route atomically: stops in vendor order, targets, envelope, filter lock', async () => {
      const turf = await createTurf()
      const spy = stubVendors()

      const res = await knock(turf.id)

      expect(res.status).toBe(201)
      expect(res.data.created).toBe(true)
      expect(res.data.route.stopCount).toBe(3)
      expect(res.data.route.totalSeconds).toBe(900)

      const route = await service.prisma.doorKnockingRoute.findUniqueOrThrow({
        where: { id: res.data.route.id },
      })
      expect(route.credits).toBe(30)

      const stops = await service.prisma.doorKnockingStop.findMany({
        where: { doorKnockingRouteId: res.data.route.id },
        orderBy: { seq: 'asc' },
        include: { targets: true },
      })
      expect(stops).toHaveLength(3)
      // Free-start open route: the first visited stop has no incoming leg;
      // the vendor's first leg belongs to the second stop.
      expect(stops[0]?.legSeconds).toBe(0)
      expect(stops[1]?.legSeconds).toBe(60)
      const dedupedStop = stops.find((stop) => stop.targets.length === 2)
      expect(dedupedStop?.targets.map((t) => t.addressKey)).toEqual([
        'KEY-1',
        'KEY-1',
      ])
      // The bbox-only person sits outside the polygon: never frozen.
      const allTargets = stops.flatMap((stop) => stop.targets)
      expect(allTargets).toHaveLength(4)

      const envelope = await service.prisma.outreach.findFirst({
        where: { doorKnockingRouteId: res.data.route.id },
      })
      expect(envelope).toMatchObject({
        campaignId: campaign.id,
        outreachType: OutreachType.nativeDoorKnocking,
        status: OutreachStatus.in_progress,
      })

      const lockedFilter = await service.prisma.voterFileFilter.findUnique({
        where: { id: filter.id },
      })
      expect(lockedFilter?.firstUsedForOutreachAt).not.toBeNull()

      const turfAfter = await service.client.get(
        `/v1/door-knocking/turfs/${turf.id}`,
        orgHeaders(),
      )
      expect(turfAfter.data.locked).toBe(true)

      const editAfter = await service.client.put(
        `/v1/door-knocking/turfs/${turf.id}`,
        { name: 'Too late' },
        { ...orgHeaders(), validateStatus: () => true },
      )
      expect(editAfter.status).toBe(409)

      expect(
        spy.mock.calls.filter(([url]) => String(url).includes('routeplanner')),
      ).toHaveLength(1)
    })

    it('two concurrent knocks make exactly one vendor call; the loser gets created:false', async () => {
      const turf = await createTurf()
      const spy = stubVendors()

      const [first, second] = await Promise.all([
        knock(turf.id),
        knock(turf.id),
      ])

      expect(first.status).toBe(201)
      expect(second.status).toBe(201)
      const created = [first.data.created, second.data.created]
      expect(created.filter(Boolean)).toHaveLength(1)
      expect(first.data.route.id).toBe(second.data.route.id)

      const geoapifyCalls = spy.mock.calls.filter(([url]) =>
        String(url).includes('routeplanner'),
      )
      expect(geoapifyCalls).toHaveLength(1)
      expect(await service.prisma.doorKnockingRoute.count()).toBe(1)
    })

    it('a vendor failure mid-knock leaves zero rows and the next knock succeeds', async () => {
      const turf = await createTurf()
      vi.spyOn(service.app.get(HttpService), 'post').mockImplementation(((
        url: string,
      ) => {
        if (url.includes('/v1/door-knocking/evaluate')) {
          return of({ data: { people: insidePeople } })
        }
        return throwError(() => new Error('vendor down'))
      }) as never)

      const failed = await knock(turf.id)
      expect(failed.status).toBe(502)
      expect(await service.prisma.doorKnockingRoute.count()).toBe(0)
      expect(await service.prisma.doorKnockingStop.count()).toBe(0)
      expect(await service.prisma.outreach.count()).toBe(0)

      stubVendors()
      const retried = await knock(turf.id)
      expect(retried.status).toBe(201)
      expect(retried.data.created).toBe(true)
    })

    it('re-knocking returns the frozen route without touching the vendor', async () => {
      const turf = await createTurf()
      stubVendors()
      const first = await knock(turf.id)
      expect(first.data.created).toBe(true)

      const spy = stubVendors()
      spy.mockClear()
      const again = await knock(turf.id, { mode: 'drive', loop: true })
      expect(again.status).toBe(201)
      expect(again.data.created).toBe(false)
      expect(again.data.route.id).toBe(first.data.route.id)
      // The frozen route keeps its original settings — the new mode/loop are
      // ignored, not applied.
      expect(again.data.route.mode).toBe('walk')
      expect(spy.mock.calls).toHaveLength(0)
    })

    it('loop knock anchors start=end and legs align from the anchor', async () => {
      const turf = await createTurf()
      let agentSent: Record<string, unknown> | undefined
      stubVendors({
        geoapify: (body) => {
          agentSent = (body as { agents: Record<string, unknown>[] }).agents[0]
          const ordered = [...body.jobs].reverse()
          return {
            features: [
              {
                properties: {
                  time: 1200,
                  distance: 1500,
                  actions: ordered.map((job) => ({
                    type: 'job',
                    job_id: job.id,
                  })),
                  // Closed tour: n + 1 legs (the extra one returns to the
                  // anchor and belongs to no stop).
                  legs: [...ordered, null].map((_, i) => ({
                    time: 60 + i,
                    distance: 100 + i,
                  })),
                },
              },
            ],
          }
        },
      })

      const res = await knock(turf.id, { loop: true })

      expect(res.status).toBe(201)
      expect(res.data.route.loop).toBe(true)
      expect(agentSent?.start_location).toEqual(agentSent?.end_location)

      const stops = await service.prisma.doorKnockingStop.findMany({
        where: { doorKnockingRouteId: res.data.route.id },
        orderBy: { seq: 'asc' },
      })
      // With a start anchor, every stop (including the first) has an
      // incoming leg.
      expect(stops[0]?.legSeconds).toBe(60)
      expect(stops[1]?.legSeconds).toBe(61)
    })

    it('rejects a turf over the 150-stop cap before calling the vendor', async () => {
      const turf = await createTurf()
      const manyPeople = Array.from({ length: 151 }, (_, i) =>
        person(i + 100, 41.9, -87.65 + i * 0.000001),
      )
      const spy = stubVendors({ people: manyPeople })

      const res = await knock(turf.id)

      expect(res.status).toBe(400)
      expect(res.data.message).toContain('150')
      expect(
        spy.mock.calls.filter(([url]) => String(url).includes('routeplanner')),
      ).toHaveLength(0)
      expect(await service.prisma.doorKnockingRoute.count()).toBe(0)
    })

    it('rejects a knock when the organization has no resolvable district', async () => {
      const suffix = Date.now()
      const noDistrictSlug = `no-district-dk-${suffix}`
      await service.prisma.organization.create({
        data: { slug: noDistrictSlug, ownerId: service.user.id },
      })
      const ndFilter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: noDistrictSlug, name: 'ND audience' },
      })
      const turfRes = await service.client.post(
        '/v1/door-knocking/turfs',
        {
          voterFileFilterId: ndFilter.id,
          name: 'ND turf',
          color: '#ff0000',
          geoPoly: GEO_POLY,
        },
        { headers: { 'x-organization-slug': noDistrictSlug } },
      )
      expect(turfRes.status).toBe(201)

      const res = await service.client.post(
        `/v1/door-knocking/turfs/${turfRes.data.id}/knock`,
        { mode: 'walk', loop: false },
        {
          headers: { 'x-organization-slug': noDistrictSlug },
          validateStatus: () => true,
        },
      )

      expect(res.status).toBe(400)
      expect(await service.prisma.doorKnockingRoute.count()).toBe(0)
    })

    it('an organization without a campaign gets a route but no envelope', async () => {
      const suffix = Date.now()
      const eoSlug = `eo-dk-${suffix}`
      await service.prisma.organization.create({
        data: {
          slug: eoSlug,
          ownerId: service.user.id,
          overrideDistrictId: DISTRICT_ID,
        },
      })
      const eoFilter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: eoSlug, name: 'EO audience' },
      })
      const turfRes = await service.client.post(
        '/v1/door-knocking/turfs',
        {
          voterFileFilterId: eoFilter.id,
          name: 'EO turf',
          color: '#3355ff',
          geoPoly: GEO_POLY,
        },
        { headers: { 'x-organization-slug': eoSlug } },
      )
      stubVendors()

      const res = await service.client.post(
        `/v1/door-knocking/turfs/${turfRes.data.id}/knock`,
        { mode: 'walk', loop: false },
        { headers: { 'x-organization-slug': eoSlug } },
      )

      expect(res.status).toBe(201)
      expect(res.data.created).toBe(true)
      expect(await service.prisma.outreach.count()).toBe(0)
    })
  })
})
