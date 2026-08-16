import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DoorKnockingPackRequest,
  GeoJsonPolygon,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { DoorKnockingPeopleApiService } from '../services/doorKnockingPeopleApi.service'
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
const GEO_POLY: GeoJsonPolygon = {
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
// Production unit-key format: HOUSE|PREFIXDIR|STREET|DESIGNATOR|SUFFIXDIR|
// APT|ZIP (DOOR_KNOCKING_UNIT_KEY_COLUMNS order) — exercises the 7-segment
// address rendering, apartment suffix included.
const PIPED_KEY = '1200|W|ELM|ST||3B|62704'

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
  jobs: Array<{ id: string; location?: [number, number] }>
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
          waypoints: ordered.map((job) => ({
            original_location: job.location ?? [0, 0],
            location: job.location ?? [0, 0],
            actions: [],
          })),
        },
      },
    ],
  }
}

// people-db targeting rides the in-process DoorKnockingPeopleApiService; the
// Geoapify SDK rides global fetch — two seams. stubVendors sets both and
// returns the FETCH spy, whose first call arg is the routeplanner URL (the
// geoapify-call-count assertions filter on it).
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
  const peopleApi = service.app.get(DoorKnockingPeopleApiService)
  vi.spyOn(peopleApi, 'evaluate').mockResolvedValue({
    people: overrides.people ?? [...insidePeople, bboxOnlyPerson],
  } as never)
  vi.spyOn(peopleApi, 'residents').mockResolvedValue(
    (overrides.residents ?? { addresses: [] }) as never,
  )
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).includes('/v1/routing')) {
      return new Response(
        JSON.stringify({
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'MultiLineString',
                coordinates: [
                  [
                    [-87.65, 41.9],
                    [-87.651, 41.901],
                  ],
                ],
              },
              properties: {},
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
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

      const frozen = await service.prisma.doorKnockingRoute.findFirstOrThrow({
        where: { doorKnockingTurfId: turf.id },
      })
      expect(frozen.pathGeometry).toMatchObject({ type: 'MultiLineString' })
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
      vi.spyOn(
        service.app.get(DoorKnockingPeopleApiService),
        'evaluate',
      ).mockResolvedValue({ people: insidePeople } as never)
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
                  waypoints: ordered.map((job) => ({
                    original_location: job.location ?? [0, 0],
                    location: job.location ?? [0, 0],
                    actions: [],
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

    // The turf's audience is the saved list, and a saved list is more than its
    // demographic pills: activity conditions, support status, contacts-made
    // and voter-likelihood overrides all resolve through separate engines that
    // the knock path used to skip entirely, so a list previewed in Contacts
    // knocked a different set of people than it displayed.
    it("resolves the list's support-status filter, excluding prior contacts", async () => {
      const priorContact = '000000aa-1111-1111-1111-111111111111'
      await service.prisma.voterFileFilter.update({
        where: { id: filter.id },
        data: { supportStatus: ['unknown'] },
      })
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: orgSlug,
          personId: priorContact,
          occurredAt: new Date('2026-07-01T10:00:00Z'),
          outcome: 'answered',
          supportAnswer: 'supporter',
        },
      })
      const turf = await createTurf()
      stubVendors()
      const peopleApi = service.app.get(DoorKnockingPeopleApiService)

      const res = await knock(turf.id)

      expect(res.status).toBe(201)
      // 'unknown' is the one rollup that can't be enumerated (a person with no
      // interaction row is derived-unknown but appears in no table), so it
      // resolves as "everyone except the known statuses" — here, the one
      // supporter logged above.
      const lastCall = vi.mocked(peopleApi.evaluate).mock.calls.at(-1)
      expect(lastCall?.[0].filters?.id).toEqual({ notIn: [priorContact] })
    })

    // supportStatus is a column on the filter row; activityConditions is a
    // relation, so it only reaches resolution if the knock's turf read
    // explicitly includes it. Loading the filter without that include still
    // type-checks and still resolves — as a list with no conditions at all —
    // so this asserts the outgoing id set, not merely that a knock succeeded.
    it("resolves the list's activity conditions, which live on a relation", async () => {
      const responded = '000000bb-1111-1111-1111-111111111111'
      const noResponse = '000000cc-1111-1111-1111-111111111111'
      const outreach = await service.prisma.outreach.create({
        data: {
          campaignId: campaign.id,
          organizationSlug: orgSlug,
          outreachType: OutreachType.text,
          status: OutreachStatus.completed,
        },
      })
      const texts = service.app.get(ContactInteractionTextService)
      await texts.create({
        organizationSlug: orgSlug,
        personId: noResponse,
        occurredAt: new Date(),
        outreachId: outreach.id,
      })
      await texts.create({
        organizationSlug: orgSlug,
        personId: responded,
        occurredAt: new Date(),
        outreachId: outreach.id,
        respondedAt: new Date(),
      })
      await service.prisma.voterFileFilter.update({
        where: { id: filter.id },
        data: {
          activityConditions: {
            create: [
              {
                outreachType: OutreachType.text,
                outreachId: outreach.id,
                actions: ['responded'],
              },
            ],
          },
        },
      })
      const turf = await createTurf()
      stubVendors()
      const peopleApi = service.app.get(DoorKnockingPeopleApiService)

      const res = await knock(turf.id)

      expect(res.status).toBe(201)
      const lastCall = vi.mocked(peopleApi.evaluate).mock.calls.at(-1)
      expect(lastCall?.[0].filters?.id).toEqual({ in: [responded] })
    })

    it('rejects a knock whose list resolves to nobody without calling the vendor', async () => {
      await service.prisma.voterFileFilter.update({
        where: { id: filter.id },
        data: { supportStatus: ['supporter'] },
      })
      const turf = await createTurf()
      const spy = stubVendors()

      const res = await knock(turf.id)

      // No interaction rows exist, so nobody derives to 'supporter' and the
      // list is empty before the polygon is even considered.
      expect(res.status).toBe(400)
      expect(res.data.message).toContain('No matching voters')
      expect(
        spy.mock.calls.filter(([url]) => String(url).includes('routeplanner')),
      ).toHaveLength(0)
      expect(await service.prisma.doorKnockingRoute.count()).toBe(0)
    })

    describe('daily waypoint budget', () => {
      // Spend accrues in the ledger, which is what the quota reads — one row
      // per vendor call, exactly as the knock path writes it. Seeded per
      // organization rather than per route: the ledger has no route foreign key
      // on purpose, so spend outlives the turf that caused it.
      const spendWaypoints = async (
        total: number,
        options: { organizationSlug?: string; occurredAt?: Date } = {},
      ) => {
        let remaining = total
        // The vendor is never asked for more than the 150-stop cap in one
        // call, so a large allowance arrives as several rows — which is also
        // how it accrues in the field.
        while (remaining > 0) {
          const size = Math.min(remaining, 150)
          await service.prisma.doorKnockingRoutePlannerSpend.create({
            data: {
              organizationSlug: options.organizationSlug ?? orgSlug,
              waypoints: size,
              credits: size * 10,
              ...(options.occurredAt ? { occurredAt: options.occurredAt } : {}),
            },
          })
          remaining -= size
        }
      }

      // The standard stub yields 3 stops, so 498 already spent puts this
      // knock one over the 500 limit.
      it('rejects a knock that would exceed the budget, before calling the vendor', async () => {
        const turf = await createTurf()
        await spendWaypoints(498)
        const spy = stubVendors()

        const res = await knock(turf.id)

        expect(res.status).toBe(429)
        expect(res.data.message).toContain('2 of your 500 daily stops')
        expect(
          spy.mock.calls.filter(([url]) =>
            String(url).includes('routeplanner'),
          ),
        ).toHaveLength(0)
        const frozen = await service.prisma.doorKnockingRoute.findUnique({
          where: { doorKnockingTurfId: turf.id },
        })
        expect(frozen).toBeNull()
      })

      // One stop lower: the limit is a ceiling the last route may reach, not
      // one it has to stay under. Without this the rejection above would also
      // pass if the budget were off by a stop in either direction.
      it('allows a knock that lands exactly on the budget', async () => {
        const turf = await createTurf()
        await spendWaypoints(497)
        stubVendors()

        const res = await knock(turf.id)

        expect(res.status).toBe(201)
        expect(res.data.route.stopCount).toBe(3)
      })

      it('ignores spend that has aged out of the rolling window', async () => {
        const turf = await createTurf()
        await spendWaypoints(498, {
          occurredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        })
        stubVendors()

        const res = await knock(turf.id)

        expect(res.status).toBe(201)
      })

      it("ignores another organization's spend", async () => {
        const turf = await createTurf()
        await spendWaypoints(498, {
          organizationSlug: `campaign-budget-${Date.now()}`,
        })
        stubVendors()

        const res = await knock(turf.id)

        expect(res.status).toBe(201)
      })

      // The reason the ledger exists: the vendor call sits inside the knock
      // transaction, so a later failure rolls the route back. Spend recorded on
      // that same transaction would vanish with it and the budget would hand
      // the allowance out twice.
      it('keeps the spend when the knock rolls back after the vendor call', async () => {
        const turf = await createTurf()
        vi.spyOn(
          service.app.get(DoorKnockingPeopleApiService),
          'evaluate',
        ).mockResolvedValue({ people: insidePeople } as never)

        // The routeplanner answers normally — and bills — but a route for this
        // turf appears from another connection while the call is in flight,
        // after the in-transaction probe has already found none. The freeze then
        // hits doorKnockingTurfId's unique constraint and the whole transaction
        // unwinds: a paid call with no route to show for it. The advisory lock
        // serializes knocks, not arbitrary writers, so this is reachable.
        let competed = false
        const spy = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementation(async (url, init) => {
            if (!String(url).includes('routeplanner')) {
              return realFetch(url as Parameters<typeof fetch>[0], init)
            }
            if (!competed) {
              competed = true
              await service.prisma.doorKnockingRoute.create({
                data: {
                  doorKnockingTurfId: turf.id,
                  mode: 'walk',
                  loop: false,
                  totalSeconds: 0,
                  totalMeters: 0,
                  credits: 0,
                },
              })
            }
            const body = JSON.parse(String(init?.body)) as PostBody
            return new Response(JSON.stringify(geoapifyPlan(body)), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          })

        const res = await knock(turf.id)

        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(
          spy.mock.calls.filter(([url]) =>
            String(url).includes('routeplanner'),
          ),
        ).toHaveLength(1)
        // The knock's own route never landed — only the competing row exists,
        // and it carries no stops.
        expect(await service.prisma.doorKnockingStop.count()).toBe(0)
        // The spend survived anyway, which is the entire reason it lives in its
        // own table written on its own connection.
        const spend =
          await service.prisma.doorKnockingRoutePlannerSpend.aggregate({
            where: { organizationSlug: orgSlug },
            _sum: { waypoints: true },
          })
        expect(spend._sum.waypoints).toBe(3)
      })
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
    // A non-target household member: the residents contract never returns a
    // requested targetPersonId in otherResidents.
    const PERSON_5 = '00000005-1111-1111-1111-111111111111'

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
              cellPhone: '(615) 555-0142',
              landline: '(615) 555-0199',
            },
            {
              personId: PERSON_2,
              firstName: 'Also',
              lastName: 'Here',
              age: 48,
              politicalParty: null,
              cellPhone: null,
              landline: null,
            },
          ],
          otherResidents: [
            { personId: PERSON_5, firstName: 'Teo', lastName: 'Vega' },
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
              cellPhone: null,
              landline: null,
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
      expect(dedupedAddress?.address).toBe('1200 W ELM ST Apt 3B')
      expect(dedupedAddress?.targets).toHaveLength(2)
      expect(dedupedAddress?.targets[0]).toMatchObject({
        personId: PERSON_1,
        name: 'Liv Current',
        age: 51,
        politicalParty: 'Democratic',
        cellPhone: '(615) 555-0142',
        landline: '(615) 555-0199',
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
            address: string
            targets: Array<Record<string, unknown>>
          }>
        }>
      )
        .flatMap((s) => s.addresses)
        .find((a) => a.addressKey === 'KEY-4')
      // Legacy sub-7-segment keys render as their first segment.
      expect(movedAddress?.address).toBe('KEY-4')
      expect(movedAddress?.targets[0]).toMatchObject({
        personId: PERSON_4,
        name: 'Voter Number4',
        age: null,
        politicalParty: null,
        // Phones come from the live row, which is exactly what a mover has
        // none of — so the canvasser never gets a number that now belongs to
        // whoever lives there instead.
        cellPhone: null,
        landline: null,
        mayHaveMoved: true,
      })
    })

    it('derives org-wide knock statuses, latest answer per person', async () => {
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
      // The latest ANSWER wins, matching how Contacts derives the same person:
      // the newer not_home is a failed re-attempt, not a retraction of the
      // support they already gave.
      expect(statusFor(PERSON_1)).toBe('supporter')
      expect(statusFor(PERSON_2)).toBe('unknown')
      // An unknown person keeps the whole stop knockable.
      expect(key1?.stop.knockStatus).toBe('unknown')

      const key3 = entries.find((e) => e.address.addressKey === 'KEY-3')
      expect(key3?.address.targets[0]?.knockStatus).toBe('supporter')
      expect(key3?.stop.knockStatus).toBe('supporter')
    })

    // Contacts lets a candidate correct a status by hand, and that correction
    // is the effective value everywhere else. The door is where it matters
    // most: knocking someone you've already marked a supporter, because the
    // map never saw the correction, is the mistake this prevents.
    it('honors a manual support-status override over the derived status', async () => {
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: orgSlug,
          personId: PERSON_1,
          occurredAt: new Date('2026-07-01T10:00:00Z'),
          outcome: 'answered',
          supportAnswer: 'non_supporter',
        },
      })
      await service.prisma.contactCurrentStatus.create({
        data: {
          organizationSlug: orgSlug,
          personId: PERSON_1,
          field: 'support_status',
          value: 'supporter',
        },
      })

      const { res } = await knockAndServe()

      const target = (
        res.data.stops as Array<{
          addresses: Array<{
            addressKey: string
            targets: Array<{ personId: string; knockStatus: string }>
          }>
        }>
      )
        .flatMap((stop) => stop.addresses)
        .find((address) => address.addressKey === PIPED_KEY)
        ?.targets.find((t) => t.personId === PERSON_1)

      expect(target?.knockStatus).toBe('supporter')
    })

    // 'undecided' and 'refused' exist only as manual overrides — nothing
    // derives them from interaction rows — and the map has no 'undecided'
    // member, so it reads as unknown: still worth knocking.
    it('maps an undecided override onto unknown', async () => {
      await service.prisma.contactCurrentStatus.create({
        data: {
          organizationSlug: orgSlug,
          personId: PERSON_3,
          field: 'support_status',
          value: 'undecided',
        },
      })

      const { res } = await knockAndServe()

      const key3 = (
        res.data.stops as Array<{
          knockStatus: string
          addresses: Array<{
            addressKey: string
            targets: Array<{ knockStatus: string }>
          }>
        }>
      )
        .flatMap((stop) => stop.addresses.map((address) => ({ stop, address })))
        .find((e) => e.address.addressKey === 'KEY-3')

      expect(key3?.address.targets[0]?.knockStatus).toBe('unknown')
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
      // No vendor traffic: neither Geoapify (fetch) nor the people-db
      // residents lookup (the shim).
      expect(
        spy.mock.calls.filter(([url]) =>
          String(url).includes('api.geoapify.com'),
        ),
      ).toHaveLength(0)
      expect(
        vi.mocked(service.app.get(DoorKnockingPeopleApiService).residents).mock
          .calls,
      ).toHaveLength(0)
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
  describe('interactions', () => {
    const CLIENT_KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

    const knockAndGetTarget = async () => {
      const turf = await createTurf()
      stubVendors()
      const knocked = await knock(turf.id)
      expect(knocked.status).toBe(201)
      const target =
        await service.prisma.doorKnockingStopTarget.findFirstOrThrow({
          orderBy: { id: 'asc' },
        })
      return target
    }

    const record = (body: Record<string, unknown>) =>
      service.client.post('/v1/door-knocking/interactions', body, {
        ...orgHeaders(),
        validateStatus: () => true,
      })

    it('records a knock and returns the derived status', async () => {
      const target = await knockAndGetTarget()

      const res = await record({
        stopTargetId: target.id,
        clientKey: CLIENT_KEY,
        outcome: 'answered',
        supportAnswer: 'supporter',
        willVote: 'yes',
        note: 'Wants a yard sign',
      })

      expect(res.status).toBe(201)
      expect(res.data).toEqual({
        personId: target.personId,
        knockStatus: 'supporter',
      })

      const row =
        await service.prisma.contactInteractionDoorKnock.findFirstOrThrow({
          where: { organizationSlug: orgSlug },
        })
      expect(row).toMatchObject({
        personId: target.personId,
        outcome: 'answered',
        supportAnswer: 'supporter',
        willVote: 'yes',
        note: 'Wants a yard sign',
        sourceId: CLIENT_KEY,
        manual: false,
      })
      expect(row.occurredAt).toBeInstanceOf(Date)
    })

    it('replaying the same clientKey re-syncs one row, never a duplicate', async () => {
      const target = await knockAndGetTarget()

      const first = await record({
        stopTargetId: target.id,
        clientKey: CLIENT_KEY,
        outcome: 'answered',
        supportAnswer: 'supporter',
      })
      const replay = await record({
        stopTargetId: target.id,
        clientKey: CLIENT_KEY,
        outcome: 'not_home',
      })

      expect(first.status).toBe(201)
      expect(replay.status).toBe(201)
      // Re-sync semantics (the CRM's recordIdempotent): the latest sync of
      // this clientKey wins, still exactly one row.
      expect(replay.data.knockStatus).toBe('not_home')
      const rows = await service.prisma.contactInteractionDoorKnock.findMany({
        where: { organizationSlug: orgSlug },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        outcome: 'not_home',
        supportAnswer: null,
      })
    })

    it('accepts the extended vocabulary end to end', async () => {
      const target = await knockAndGetTarget()

      const res = await record({
        stopTargetId: target.id,
        clientKey: CLIENT_KEY,
        outcome: 'inaccessible',
      })

      expect(res.status).toBe(201)
      expect(res.data.knockStatus).toBe('inaccessible')
    })

    it('rejects answers from doors that were not answered', async () => {
      const target = await knockAndGetTarget()

      const support = await record({
        stopTargetId: target.id,
        clientKey: CLIENT_KEY,
        outcome: 'inaccessible',
        supportAnswer: 'supporter',
      })
      const gotv = await record({
        stopTargetId: target.id,
        clientKey: CLIENT_KEY,
        outcome: 'not_home',
        willVote: 'yes',
      })

      expect(support.status).toBe(400)
      expect(gotv.status).toBe(400)
      expect(await service.prisma.contactInteractionDoorKnock.count()).toBe(0)
    })

    it("404s for another organization's stop target", async () => {
      const target = await knockAndGetTarget()
      const suffix = Date.now()
      const otherSlug = `campaign-int-${suffix}`
      await service.prisma.organization.create({
        data: {
          slug: otherSlug,
          ownerId: service.user.id,
          overrideDistrictId: DISTRICT_ID,
        },
      })

      const res = await service.client.post(
        '/v1/door-knocking/interactions',
        {
          stopTargetId: target.id,
          clientKey: CLIENT_KEY,
          outcome: 'answered',
        },
        {
          headers: { 'x-organization-slug': otherSlug },
          validateStatus: () => true,
        },
      )

      expect(res.status).toBe(404)
      expect(await service.prisma.contactInteractionDoorKnock.count()).toBe(0)
    })

    it('the recorded status shows up on the next serve', async () => {
      const turf = await createTurf()
      stubVendors({
        residents: {
          addresses: [],
        },
      })
      await knock(turf.id)
      const target =
        await service.prisma.doorKnockingStopTarget.findFirstOrThrow({
          orderBy: { id: 'asc' },
        })
      await record({
        stopTargetId: target.id,
        clientKey: CLIENT_KEY,
        outcome: 'answered',
        supportAnswer: 'non_supporter',
      })

      const res = await service.client.get(
        `/v1/door-knocking/turfs/${turf.id}/route`,
        { ...orgHeaders(), validateStatus: () => true },
      )

      expect(res.status).toBe(200)
      const targets = (
        res.data.stops as Array<{
          addresses: Array<{
            targets: Array<{ personId: string; knockStatus: string }>
          }>
        }>
      )
        .flatMap((s) => s.addresses)
        .flatMap((a) => a.targets)
      expect(
        targets.find((t) => t.personId === target.personId)?.knockStatus,
      ).toBe('non_supporter')
    })
    describe('willVote -> voter_likelihood override events (ENG-10841)', () => {
      const recordWillVote = async (willVote: string) => {
        const target = await knockAndGetTarget()
        const res = await record({
          stopTargetId: target.id,
          clientKey: CLIENT_KEY,
          outcome: 'answered',
          willVote,
        })
        expect(res.status).toBe(201)
        return target
      }

      it('yes writes a likely voter_likelihood event, sourced door_knock with the clientKey and no actor', async () => {
        const target = await recordWillVote('yes')

        const event = await service.prisma.contactStatusEvent.findFirstOrThrow({
          where: { organizationSlug: orgSlug, personId: target.personId },
        })
        expect(event).toMatchObject({
          field: 'voter_likelihood',
          toValue: 'likely',
          source: 'door_knock',
          actorUserId: null,
          sourceId: CLIENT_KEY,
        })

        const current =
          await service.prisma.contactCurrentStatus.findFirstOrThrow({
            where: {
              organizationSlug: orgSlug,
              personId: target.personId,
              field: 'voter_likelihood',
            },
          })
        expect(current.value).toBe('likely')
      })

      it('no writes an unlikely voter_likelihood event', async () => {
        const target = await recordWillVote('no')

        const event = await service.prisma.contactStatusEvent.findFirstOrThrow({
          where: { organizationSlug: orgSlug, personId: target.personId },
        })
        expect(event).toMatchObject({
          toValue: 'unlikely',
          source: 'door_knock',
        })
      })

      it('unsure writes no status event', async () => {
        const target = await recordWillVote('unsure')

        const events = await service.prisma.contactStatusEvent.findMany({
          where: { organizationSlug: orgSlug, personId: target.personId },
        })
        expect(events).toHaveLength(0)
        const current = await service.prisma.contactCurrentStatus.findFirst({
          where: {
            organizationSlug: orgSlug,
            personId: target.personId,
            field: 'voter_likelihood',
          },
        })
        expect(current).toBeNull()
      })

      // Proves the ContactStatusService no-op (not just the trivial
      // fromValue===toValue skip): sourceId is keyed to the physical knock,
      // so even a corrected answer on the same clientKey can't create a
      // second event — an accepted limitation, not a re-derivation of
      // "latest wins".
      it('replaying the same clientKey with a changed answer still writes no duplicate event', async () => {
        const target = await knockAndGetTarget()

        const first = await record({
          stopTargetId: target.id,
          clientKey: CLIENT_KEY,
          outcome: 'answered',
          willVote: 'yes',
        })
        const corrected = await record({
          stopTargetId: target.id,
          clientKey: CLIENT_KEY,
          outcome: 'answered',
          willVote: 'no',
        })

        expect(first.status).toBe(201)
        expect(corrected.status).toBe(201)
        const events = await service.prisma.contactStatusEvent.findMany({
          where: { organizationSlug: orgSlug, personId: target.personId },
        })
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({ toValue: 'likely' })
        const current =
          await service.prisma.contactCurrentStatus.findFirstOrThrow({
            where: {
              organizationSlug: orgSlug,
              personId: target.personId,
              field: 'voter_likelihood',
            },
          })
        expect(current.value).toBe('likely')
      })

      it('does not write a voter_likelihood event for an eo- (Serve) organization', async () => {
        const suffix = Date.now()
        const eoSlug = `eo-dk-willvote-${suffix}`
        await service.prisma.organization.create({
          data: {
            slug: eoSlug,
            ownerId: service.user.id,
            overrideDistrictId: DISTRICT_ID,
          },
        })
        const eoFilter = await service.prisma.voterFileFilter.create({
          data: { organizationSlug: eoSlug, name: 'EO willVote audience' },
        })
        const turfRes = await service.client.post(
          '/v1/door-knocking/turfs',
          {
            voterFileFilterId: eoFilter.id,
            name: 'EO willVote turf',
            color: '#3355ff',
            geoPoly: GEO_POLY,
          },
          { headers: { 'x-organization-slug': eoSlug } },
        )
        stubVendors()
        await service.client.post(
          `/v1/door-knocking/turfs/${turfRes.data.id}/knock`,
          { mode: 'walk', loop: false },
          { headers: { 'x-organization-slug': eoSlug } },
        )
        const eoTarget =
          await service.prisma.doorKnockingStopTarget.findFirstOrThrow({
            orderBy: { id: 'asc' },
          })

        const res = await service.client.post(
          '/v1/door-knocking/interactions',
          {
            stopTargetId: eoTarget.id,
            clientKey: CLIENT_KEY,
            outcome: 'answered',
            willVote: 'yes',
          },
          { headers: { 'x-organization-slug': eoSlug } },
        )

        expect(res.status).toBe(201)
        const events = await service.prisma.contactStatusEvent.findMany({
          where: { organizationSlug: eoSlug },
        })
        expect(events).toHaveLength(0)
      })
    })
  })
  describe('pack', () => {
    it('proxies the binary and threads org knock statuses', async () => {
      const personId = '77777777-1111-1111-1111-111111111111'
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: orgSlug,
          personId,
          occurredAt: new Date('2026-07-10T10:00:00Z'),
          outcome: 'answered',
          supportAnswer: 'supporter',
        },
      })
      const packBytes = Buffer.from([1, 2, 3, 4])
      let packRequest: DoorKnockingPackRequest | undefined
      vi.spyOn(
        service.app.get(DoorKnockingPeopleApiService),
        'pack',
      ).mockImplementation((request: DoorKnockingPackRequest) => {
        packRequest = request
        return Promise.resolve(packBytes)
      })

      const res = await service.client.get('/v1/door-knocking/pack', {
        ...orgHeaders(),
        responseType: 'arraybuffer',
        validateStatus: () => true,
      })

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('application/octet-stream')
      expect(Buffer.from(res.data as ArrayBuffer)).toEqual(packBytes)
      expect(packRequest?.knockStatuses).toEqual([
        { personId, status: 'supporter' },
      ])
      expect(packRequest?.districtId).toBe(DISTRICT_ID)
    })
  })
})
