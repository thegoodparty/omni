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

// Production addressKey format — the serve payload's frozen address is the
// key's first segment.
const PIPED_KEY = '1200 W ELM ST|SPRINGFIELD|IL|62704'

// Three distinct coordinates inside the polygon, two people sharing one of
// them (dedupes to one stop), plus one person inside the bbox but OUTSIDE
// the polygon corner cut — the ray-cast must drop them.
const insidePeople = [
  person(1, 41.9, -87.65, PIPED_KEY),
  person(2, 41.9, -87.65, PIPED_KEY),
  person(3, 41.901, -87.651),
  person(4, 41.902, -87.652),
]
const bboxOnlyPerson = person(9, 41.9, -87.6401)

type PostBody = {
  jobs: Array<{ id: string }>
  agents?: Array<Record<string, unknown>>
}

// Geoapify visits the jobs in REVERSED id order so tests prove seq comes
// from the vendor plan, not from input order.
// Response-faithful FeatureCollection: the SDK's result converter reads
// properties.params (the input echo) and each feature's agent_index.
const geoapifyPlan = (body: PostBody) => {
  const ordered = [...body.jobs].reverse()
  return {
    type: 'FeatureCollection',
    properties: {
      mode: 'walk',
      params: {
        mode: 'walk',
        agents: body.agents ?? [{}],
        jobs: body.jobs,
        shipments: [],
        locations: [],
      },
    },
    features: [
      {
        type: 'Feature',
        properties: {
          agent_index: 0,
          time: 900,
          distance: 1200,
          mode: 'walk',
          actions: ordered.map((job) => ({ type: 'job', job_id: job.id })),
          legs: ordered.map((_, i) => ({ time: 60 + i, distance: 100 + i })),
          waypoints: [],
        },
      },
    ],
  }
}

// people-api rides HttpService/axios; the Geoapify SDK rides global fetch —
// two seams. stubVendors sets both and returns the FETCH spy, whose first
// call arg is the routeplanner URL (the geoapify-call-count assertions
// filter on it, same as the old HttpService spy).
// Captured before any spy replaces it — a later capture inside stubVendors
// would grab the previous test's spy and recurse.
const realFetch = globalThis.fetch.bind(globalThis)

const stubVendors = (
  overrides: {
    people?: Array<ReturnType<typeof person>>
    geoapify?: (body: PostBody) => unknown
    residents?: { addresses: Array<Record<string, unknown>> }
  } = {},
) => {
  vi.spyOn(service.app.get(HttpService), 'post').mockImplementation(((
    url: string,
  ) => {
    if (url.includes('/v1/door-knocking/evaluate')) {
      return of({
        data: {
          people: overrides.people ?? [...insidePeople, bboxOnlyPerson],
        },
      })
    }
    if (url.includes('/v1/door-knocking/residents')) {
      return of({ data: overrides.residents ?? { addresses: [] } })
    }
    return of({ data: {} })
  }) as never)
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (!String(url).includes('routeplanner')) {
      // Clerk enrichment etc. still ride real fetch.
      return realFetch(url as Parameters<typeof fetch>[0], init)
    }
    const body = JSON.parse(String(init?.body)) as PostBody
    const build = overrides.geoapify ?? geoapifyPlan
    return new Response(JSON.stringify(build(body)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

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
        PIPED_KEY,
        PIPED_KEY,
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
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('vendor down'))

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
      expect(
        spy.mock.calls.filter(([url]) => String(url).includes('routeplanner')),
      ).toHaveLength(0)
    })

    it('loop knock anchors start=end and legs align from the anchor', async () => {
      const turf = await createTurf()
      let agentSent: Record<string, unknown> | undefined
      stubVendors({
        geoapify: (body) => {
          agentSent = body.agents?.[0]
          const ordered = [...body.jobs].reverse()
          return {
            type: 'FeatureCollection',
            properties: {
              mode: 'walk',
              params: {
                mode: 'walk',
                agents: body.agents ?? [{}],
                jobs: body.jobs,
                shipments: [],
                locations: [],
              },
            },
            features: [
              {
                type: 'Feature',
                properties: {
                  agent_index: 0,
                  time: 1200,
                  distance: 1500,
                  mode: 'walk',
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
                  waypoints: [],
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
  describe('serve', () => {
    const PERSON_1 = '00000001-1111-1111-1111-111111111111'
    const PERSON_2 = '00000002-1111-1111-1111-111111111111'
    const PERSON_3 = '00000003-1111-1111-1111-111111111111'
    const PERSON_4 = '00000004-1111-1111-1111-111111111111'

    const liveResidents = {
      addresses: [
        {
          addressKey: PIPED_KEY,
          targets: [
            {
              personId: PERSON_1,
              firstName: 'Liv',
              lastName: 'Current',
              age: 51,
              politicalParty: 'Democratic',
            },
            {
              personId: PERSON_2,
              firstName: 'Also',
              lastName: 'Here',
              age: 48,
              politicalParty: null,
            },
          ],
          otherResidents: [
            { personId: PERSON_4, firstName: 'Teo', lastName: 'Vega' },
          ],
        },
        {
          addressKey: 'KEY-3',
          targets: [
            {
              personId: PERSON_3,
              firstName: 'Marisol',
              lastName: 'Vega',
              age: 34,
              politicalParty: 'Independent',
            },
          ],
          otherResidents: [],
        },
        // KEY-4 absent: its target moved away since the freeze.
      ],
    }

    const knockAndServe = async () => {
      const turf = await createTurf()
      stubVendors({ residents: liveResidents })
      const knocked = await knock(turf.id)
      expect(knocked.status).toBe(201)
      const res = await service.client.get(
        `/v1/door-knocking/turfs/${turf.id}/route`,
        { ...orgHeaders(), validateStatus: () => true },
      )
      return { turf, res }
    }

    it('serves the frozen route enriched with live residents', async () => {
      const { res } = await knockAndServe()

      expect(res.status).toBe(200)
      expect(res.data.route.stopCount).toBe(3)
      expect(res.data.stops.map((s: { seq: number }) => s.seq)).toEqual([
        1, 2, 3,
      ])

      const stops = res.data.stops as Array<{
        addresses: Array<{
          addressKey: string
          address: string
          targets: Array<Record<string, unknown>>
          otherResidents: Array<{ name: string | null }>
        }>
      }>
      const dedupedAddress = stops
        .flatMap((s) => s.addresses)
        .find((a) => a.addressKey === PIPED_KEY)
      // The frozen display address is the key's street-line segment.
      expect(dedupedAddress?.address).toBe('1200 W ELM ST')
      expect(dedupedAddress?.targets).toHaveLength(2)
      expect(dedupedAddress?.targets[0]).toMatchObject({
        personId: PERSON_1,
        name: 'Liv Current',
        age: 51,
        politicalParty: 'Democratic',
        mayHaveMoved: false,
      })
      expect(dedupedAddress?.otherResidents).toEqual([{ name: 'Teo Vega' }])
    })

    it('flags moved-away targets and falls back to the frozen name', async () => {
      const { res } = await knockAndServe()

      const movedAddress = (
        res.data.stops as Array<{
          addresses: Array<{
            addressKey: string
            targets: Array<Record<string, unknown>>
          }>
        }>
      )
        .flatMap((s) => s.addresses)
        .find((a) => a.addressKey === 'KEY-4')
      expect(movedAddress?.targets[0]).toMatchObject({
        personId: PERSON_4,
        name: 'Voter Number4',
        age: null,
        politicalParty: null,
        mayHaveMoved: true,
      })
    })

    it('derives org-wide knock statuses, latest row per person', async () => {
      await service.prisma.contactInteractionDoorKnock.createMany({
        data: [
          {
            organizationSlug: orgSlug,
            personId: PERSON_1,
            occurredAt: new Date('2026-07-01T10:00:00Z'),
            outcome: 'answered',
            supportAnswer: 'supporter',
          },
          {
            organizationSlug: orgSlug,
            personId: PERSON_1,
            occurredAt: new Date('2026-07-10T10:00:00Z'),
            outcome: 'not_home',
          },
          {
            organizationSlug: orgSlug,
            personId: PERSON_3,
            occurredAt: new Date('2026-07-05T10:00:00Z'),
            outcome: 'answered',
            supportAnswer: 'supporter',
          },
        ],
      })

      const { res } = await knockAndServe()

      const entries = (
        res.data.stops as Array<{
          knockStatus: string
          addresses: Array<{
            addressKey: string
            targets: Array<{ personId: string; knockStatus: string }>
          }>
        }>
      ).flatMap((stop) => stop.addresses.map((address) => ({ stop, address })))

      const key1 = entries.find((e) => e.address.addressKey === PIPED_KEY)
      const statusFor = (personId: string) =>
        key1?.address.targets.find((t) => t.personId === personId)?.knockStatus
      // Latest row wins: the newer not_home beats the older supporter.
      expect(statusFor(PERSON_1)).toBe('not_home')
      expect(statusFor(PERSON_2)).toBe('unknown')
      // An unknown person keeps the whole stop knockable.
      expect(key1?.stop.knockStatus).toBe('unknown')

      const key3 = entries.find((e) => e.address.addressKey === 'KEY-3')
      expect(key3?.address.targets[0]?.knockStatus).toBe('supporter')
      expect(key3?.stop.knockStatus).toBe('supporter')
    })

    it('serves a targetless route without calling people-api', async () => {
      const turf = await createTurf()
      await service.prisma.doorKnockingRoute.create({
        data: {
          doorKnockingTurfId: turf.id,
          mode: 'walk',
          loop: false,
          totalSeconds: 0,
          totalMeters: 0,
          credits: 0,
          stops: {
            create: [
              {
                seq: 1,
                lat: 41.9,
                lng: -87.65,
                displayAddress: '1 W Elm St',
                legSeconds: 0,
                legMeters: 0,
              },
            ],
          },
        },
      })
      const spy = stubVendors()

      const res = await service.client.get(
        `/v1/door-knocking/turfs/${turf.id}/route`,
        { ...orgHeaders(), validateStatus: () => true },
      )

      expect(res.status).toBe(200)
      expect(res.data.stops[0].addresses).toEqual([])
      expect(res.data.stops[0].knockStatus).toBe('unknown')
      expect(spy.mock.calls).toHaveLength(0)
    })

    it('404s for a turf that has not been knocked', async () => {
      const turf = await createTurf()
      const res = await service.client.get(
        `/v1/door-knocking/turfs/${turf.id}/route`,
        { ...orgHeaders(), validateStatus: () => true },
      )
      expect(res.status).toBe(404)
    })

    it("404s for another organization's route", async () => {
      const { turf } = await knockAndServe()
      const suffix = Date.now()
      const otherSlug = `campaign-other-${suffix}`
      await service.prisma.organization.create({
        data: {
          slug: otherSlug,
          ownerId: service.user.id,
          overrideDistrictId: DISTRICT_ID,
        },
      })
      const res = await service.client.get(
        `/v1/door-knocking/turfs/${turf.id}/route`,
        {
          headers: { 'x-organization-slug': otherSlug },
          validateStatus: () => true,
        },
      )
      expect(res.status).toBe(404)
    })
  })
})
