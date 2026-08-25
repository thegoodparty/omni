import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DoorKnockingPackRequest,
  GeoJsonPolygon,
  ROUTE_TARGET_ACTIVITY_LIMIT,
  ROUTE_TARGET_NOTE_LIMIT,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { DoorKnockingPeopleApiService } from '../services/doorKnockingPeopleApi.service'
import { DoorKnockingKnockService } from '../services/doorKnockingKnock.service'
import { DoorKnockingNotesService } from '../services/doorKnockingNotes.service'
import { DoorKnockingServeService } from '../services/doorKnockingServe.service'
import { DoorKnockingTurfCountsService } from '../services/doorKnockingTurfCounts.service'
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
    // Pro, because every route but the two suppression writes is gated on it
    // (ContactsService.assertProAccess). The non-Pro refusals live in their own
    // describe block below, which downgrades this campaign.
    campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `dk-campaign-${suffix}`,
        organizationSlug: orgSlug,
        isPro: true,
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
        '/v1/door-knocking/turfs',
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

  describe('list lifecycle', () => {
    const complete = (turfId: number) =>
      service.client.post(
        `/v1/door-knocking/turfs/${turfId}/complete`,
        {},
        {
          ...orgHeaders(),
          validateStatus: () => true,
        },
      )

    const setArchived = (turfId: number, archived: boolean) =>
      service.client.post(
        `/v1/door-knocking/turfs/${turfId}/archive`,
        { archived },
        { ...orgHeaders(), validateStatus: () => true },
      )

    const knockedTurf = async (name = 'Elm St turf') => {
      const turf = await createTurf(name)
      stubVendors()
      const res = await knock(turf.id)
      expect(res.status).toBe(201)
      return { turf, routeId: res.data.route.id as number }
    }

    it('completing a walk stamps the turf and closes its outreach envelope', async () => {
      const { turf, routeId } = await knockedTurf()

      const res = await complete(turf.id)
      expect(res.status).toBe(201)
      expect(res.data.completedAt).not.toBeNull()
      // The response still carries counts. It is assembled from the row read
      // inside the write transaction plus a counts read after it, rather than
      // by re-fetching the turf — so this is what catches that split coming
      // apart and silently answering nulls.
      expect(res.data.doorCount).toEqual(expect.any(Number))

      // The envelope is the Win outreach history's copy of the same fact. It
      // is a mirror, not the source — hence asserting both moved together.
      const envelope = await service.prisma.outreach.findFirst({
        where: { doorKnockingRouteId: routeId },
      })
      expect(envelope?.status).toBe(OutreachStatus.completed)
    })

    // The card renders the completion date, so a stray second tap must not
    // move it — that would misreport when the walk actually finished.
    it('completing twice keeps the original timestamp', async () => {
      const { turf } = await knockedTurf()

      const first = await complete(turf.id)
      const second = await complete(turf.id)

      expect(second.status).toBe(201)
      expect(second.data.completedAt).toBe(first.data.completedAt)
    })

    it('refuses to complete a list nobody has knocked', async () => {
      const turf = await createTurf()

      const res = await complete(turf.id)
      expect(res.status).toBe(409)
    })

    const envelopeFor = (routeId: number) =>
      service.prisma.outreach.findFirstOrThrow({
        where: { doorKnockingRouteId: routeId },
      })

    // Archived is a shelf the client renders differently, not a hidden state:
    // the row keeps coming back so there is something to restore, and so the
    // print path can still resolve the list's name.
    //
    // Both directions mirror onto the envelope, in the same transaction as the
    // turf. Restore is the half that is easy to forget: an archive that mirrors
    // and a restore that does not leaves the two rows disagreeing again, one
    // press later.
    it('archives and restores, moving the outreach envelope with the list', async () => {
      const { turf, routeId } = await knockedTurf()

      const archived = await setArchived(turf.id, true)
      expect(archived.status).toBe(201)
      expect(archived.data.archivedAt).not.toBeNull()
      expect((await envelopeFor(routeId)).archivedAt?.toISOString()).toBe(
        archived.data.archivedAt,
      )

      const list = await service.client.get(
        '/v1/door-knocking/turfs',
        orgHeaders(),
      )
      expect(list.data).toHaveLength(1)
      expect(list.data[0].archivedAt).not.toBeNull()

      const restored = await setArchived(turf.id, false)
      expect(restored.data.archivedAt).toBeNull()
      expect((await envelopeFor(routeId)).archivedAt).toBeNull()
    })

    // Same reasoning as completing twice: the card renders "archived since".
    // The envelope is held to it too — the mirror runs on every call, so it
    // writes the turf's existing stamp rather than a fresh `now`.
    it('archiving twice keeps the original timestamp on both rows', async () => {
      const { turf, routeId } = await knockedTurf()

      const first = await setArchived(turf.id, true)
      const mirrored = (await envelopeFor(routeId)).archivedAt
      const second = await setArchived(turf.id, true)

      expect(second.data.archivedAt).toBe(first.data.archivedAt)
      expect((await envelopeFor(routeId)).archivedAt).toEqual(mirrored)
    })

    // The drift this mirror exists to end, in the state prod is already in:
    // lists archived before the mirror shipped have an envelope that never
    // followed. Pressing Archive again is the only repair a candidate has, so
    // the mirror runs ahead of the idempotence guard rather than behind it.
    it('mirrors a list archived before the envelope was ever joined to it', async () => {
      const { turf, routeId } = await knockedTurf()
      const archivedAt = new Date('2026-08-01T00:00:00.000Z')
      await service.prisma.doorKnockingTurf.update({
        where: { id: turf.id },
        data: { archivedAt },
      })

      const res = await setArchived(turf.id, true)

      expect(res.status).toBe(201)
      // The repair must not cost the original date on the way through.
      expect(res.data.archivedAt).toBe(archivedAt.toISOString())
      expect((await envelopeFor(routeId)).archivedAt).toEqual(archivedAt)
    })

    // A Serve org knocks without a campaign, so the knock transaction never
    // creates an envelope. Nothing to mirror is the normal outcome there, not
    // an error — hence updateMany rather than update.
    it('archives a list for an organization that has no outreach envelope', async () => {
      const suffix = Date.now()
      const eoSlug = `eo-dk-archive-${suffix}`
      await service.prisma.organization.create({
        data: {
          slug: eoSlug,
          ownerId: service.user.id,
          overrideDistrictId: DISTRICT_ID,
        },
      })
      const eoFilter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: eoSlug, name: 'EO archive audience' },
      })
      const eoHeaders = { headers: { 'x-organization-slug': eoSlug } }
      const created = await service.client.post(
        '/v1/door-knocking/turfs',
        {
          voterFileFilterId: eoFilter.id,
          name: 'EO archive turf',
          color: '#3355ff',
          geoPoly: GEO_POLY,
        },
        eoHeaders,
      )
      stubVendors()
      const knocked = await service.client.post(
        `/v1/door-knocking/turfs/${created.data.id}/knock`,
        { mode: 'walk', loop: false },
        eoHeaders,
      )
      expect(
        await service.prisma.outreach.count({
          where: { doorKnockingRouteId: knocked.data.route.id },
        }),
      ).toBe(0)

      const res = await service.client.post(
        `/v1/door-knocking/turfs/${created.data.id}/archive`,
        { archived: true },
        { ...eoHeaders, validateStatus: () => true },
      )

      expect(res.status).toBe(201)
      expect(res.data.archivedAt).not.toBeNull()
    })

    it('hard-deletes an unknocked list, because there is nothing to keep', async () => {
      const turf = await createTurf()

      const res = await service.client.delete(
        `/v1/door-knocking/turfs/${turf.id}`,
        orgHeaders(),
      )
      expect(res.status).toBe(204)

      const row = await service.prisma.doorKnockingTurf.findUnique({
        where: { id: turf.id },
      })
      expect(row).toBeNull()
    })

    // The reason soft delete exists. A hard delete here would cascade the
    // route someone was billed for, its frozen addresses, and the outreach
    // envelope — so this asserts each of those survives while the list itself
    // becomes unreachable.
    it('tombstones a knocked list instead of cascading its paid route away', async () => {
      const { turf, routeId } = await knockedTurf()

      const target =
        await service.prisma.doorKnockingStopTarget.findFirstOrThrow({
          where: { stop: { doorKnockingRouteId: routeId } },
        })
      const logged = await service.client.post(
        '/v1/door-knocking/interactions',
        {
          stopTargetId: target.id,
          clientKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          outcome: 'answered',
        },
        orgHeaders(),
      )
      expect(logged.status).toBe(201)

      const res = await service.client.delete(
        `/v1/door-knocking/turfs/${turf.id}`,
        orgHeaders(),
      )
      expect(res.status).toBe(204)

      const row = await service.prisma.doorKnockingTurf.findUnique({
        where: { id: turf.id },
      })
      expect(row?.deletedAt).not.toBeNull()

      expect(
        await service.prisma.doorKnockingRoute.findUnique({
          where: { id: routeId },
        }),
      ).not.toBeNull()
      expect(
        await service.prisma.outreach.findFirst({
          where: { doorKnockingRouteId: routeId },
        }),
      ).not.toBeNull()
      // Knock history hangs off the organization rather than this chain, so it
      // was never at risk — asserted anyway, because that independence is the
      // premise the whole delete policy rests on.
      expect(await service.prisma.contactInteractionDoorKnock.count()).toBe(1)
    })

    it('treats a tombstoned list as gone from every read and write path', async () => {
      const { turf } = await knockedTurf()
      await service.client.delete(
        `/v1/door-knocking/turfs/${turf.id}`,
        orgHeaders(),
      )

      const opts = { ...orgHeaders(), validateStatus: () => true }
      const list = await service.client.get(
        '/v1/door-knocking/turfs',
        orgHeaders(),
      )
      expect(list.data).toHaveLength(0)

      expect(
        (await service.client.get(`/v1/door-knocking/turfs/${turf.id}`, opts))
          .status,
      ).toBe(404)
      expect(
        (
          await service.client.get(
            `/v1/door-knocking/turfs/${turf.id}/route`,
            opts,
          )
        ).status,
      ).toBe(404)
      // The one that would be silent: re-knocking a deleted list would bill a
      // second route against a list the candidate believes is gone.
      expect((await knock(turf.id)).status).toBe(404)
    })

    // The deliberate exception to the line above, pinned because it reads like
    // an oversight. The phone snapshots the route and syncs later, so a list
    // deleted mid-walk must not turn a canvasser's queued knocks into 404s and
    // throw away work they actually did. These rows hang off the organization
    // rather than the turf, so they outlive the list by design.
    it('still accepts a knock synced against a tombstoned list', async () => {
      const { turf, routeId } = await knockedTurf()
      const target =
        await service.prisma.doorKnockingStopTarget.findFirstOrThrow({
          where: { stop: { doorKnockingRouteId: routeId } },
        })

      await service.client.delete(
        `/v1/door-knocking/turfs/${turf.id}`,
        orgHeaders(),
      )

      const logged = await service.client.post(
        '/v1/door-knocking/interactions',
        {
          stopTargetId: target.id,
          clientKey: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
          outcome: 'not_home',
        },
        { ...orgHeaders(), validateStatus: () => true },
      )
      expect(logged.status).toBe(201)
      expect(await service.prisma.contactInteractionDoorKnock.count()).toBe(1)
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

      // The DoorKnockingSpend line is the only global view of Geoapify spend:
      // the route-planner-spend-ceiling alert sums its `credits` across every
      // organization, and the per-org-per-day queries in
      // docs/door-knocking.md group by its `organizationSlug`. Renaming the
      // event or dropping a field silently blinds both.
      it('logs the spend with the org and credits the ceiling alert reads', async () => {
        const turf = await createTurf()
        stubVendors()
        const logSpy = vi.spyOn(
          service.app.get(DoorKnockingKnockService).logger,
          'info',
        )

        const res = await knock(turf.id)

        expect(res.status).toBe(201)
        expect(logSpy).toHaveBeenCalledWith({
          event: 'DoorKnockingSpend',
          organizationSlug: orgSlug,
          turfId: turf.id,
          waypoints: 3,
          credits: 30,
        })
      })
    })

    it('rejects a knock when the organization has no resolvable district', async () => {
      const suffix = Date.now()
      const noDistrictSlug = `no-district-dk-${suffix}`
      await service.prisma.organization.create({
        data: { slug: noDistrictSlug, ownerId: service.user.id },
      })
      // Pro, so the refusal under test is the missing district and not the
      // Pro gate every route here now runs first.
      await service.prisma.campaign.create({
        data: {
          userId: service.user.id,
          slug: `no-district-campaign-${suffix}`,
          organizationSlug: noDistrictSlug,
          isPro: true,
        },
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
              // The eleven attributes people-api resolved, already through the
              // display mappers. A mix of answered and absent, because a real
              // row is usually partial.
              registeredVoter: true,
              turnoutLikelihood: 'Super',
              maritalStatus: 'Likely Married',
              hasChildrenUnder18: 'Yes',
              veteranStatus: 'Yes',
              homeowner: 'Likely',
              businessOwner: null,
              levelOfEducation: 'Graduate Degree',
              estimatedIncomeAmount: 82000,
              language: 'Spanish',
              ethnicityGroup: 'Hispanic',
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

    it('carries the demographic profile onto a live target', async () => {
      const { res } = await knockAndServe()

      const target = res.data.stops
        .flatMap((stop: { addresses: Array<{ targets: unknown[] }> }) =>
          stop.addresses.flatMap((address) => address.targets),
        )
        .find((t: { personId: string }) => t.personId === PERSON_1)

      expect(target).toMatchObject({
        registeredVoter: true,
        turnoutLikelihood: 'Super',
        maritalStatus: 'Likely Married',
        hasChildrenUnder18: 'Yes',
        veteranStatus: 'Yes',
        homeowner: 'Likely',
        // Presence-only: absent stays null, never 'No'.
        businessOwner: null,
        levelOfEducation: 'Graduate Degree',
        estimatedIncomeAmount: 82000,
        language: 'Spanish',
        ethnicityGroup: 'Hispanic',
      })
    })

    // Targets only. A non-target resident is household context for the
    // conversation, not someone the candidate asked to contact — the same rule
    // that already keeps phone numbers off them.
    it('leaves other residents name-only', async () => {
      const { res } = await knockAndServe()

      const residents = res.data.stops.flatMap(
        (stop: { addresses: Array<{ otherResidents: unknown[] }> }) =>
          stop.addresses.flatMap((address) => address.otherResidents),
      )

      expect(residents).not.toHaveLength(0)
      for (const resident of residents) {
        expect(Object.keys(resident as object)).toEqual(['name'])
      }
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
        // The demographic profile is live-only for the same reason: a mover has
        // no live row, so the card describes nobody rather than describing
        // whoever lives at that address now.
        registeredVoter: null,
        turnoutLikelihood: null,
        maritalStatus: null,
        hasChildrenUnder18: null,
        veteranStatus: null,
        homeowner: null,
        businessOwner: null,
        levelOfEducation: null,
        estimatedIncomeAmount: null,
        language: null,
        ethnicityGroup: null,
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

      const addresses = (
        res.data.stops as Array<{
          addresses: Array<{
            addressKey: string
            targets: Array<{ personId: string; knockStatus: string }>
          }>
        }>
      ).flatMap((stop) => stop.addresses)

      const key1 = addresses.find((a) => a.addressKey === PIPED_KEY)
      const statusFor = (personId: string) =>
        key1?.targets.find((t) => t.personId === personId)?.knockStatus
      // The latest ANSWER wins, matching how Contacts derives the same person:
      // the newer not_home is a failed re-attempt, not a retraction of the
      // support they already gave.
      expect(statusFor(PERSON_1)).toBe('supporter')
      expect(statusFor(PERSON_2)).toBe('unknown')

      const key3 = addresses.find((a) => a.addressKey === 'KEY-3')
      expect(key3?.targets[0]?.knockStatus).toBe('supporter')
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
          addresses: Array<{
            addressKey: string
            targets: Array<{ knockStatus: string }>
          }>
        }>
      )
        .flatMap((stop) => stop.addresses)
        .find((address) => address.addressKey === 'KEY-3')

      expect(key3?.targets[0]?.knockStatus).toBe('unknown')
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

    // ADR 0009. The feed rides the route payload rather than a per-person
    // fetch, so these assertions are what the walk has to work from when the
    // canvasser is a block into a dead zone.
    describe('per-resident activity feed (ADR 0009)', () => {
      const historyFor = (
        res: { data: { stops: unknown } },
        personId: string,
      ) =>
        (
          res.data.stops as Array<{
            addresses: Array<{
              targets: Array<{
                personId: string
                history: Array<{ type: string; date: string }>
              }>
            }>
          }>
        )
          .flatMap((stop) => stop.addresses)
          .flatMap((address) => address.targets)
          .find((target) => target.personId === personId)?.history

      it('serves an empty feed for a resident nobody has contacted', async () => {
        const { res } = await knockAndServe()

        expect(res.status).toBe(200)
        expect(historyFor(res, PERSON_2)).toEqual([])
      })

      it('orders several attempts newest first', async () => {
        await service.prisma.contactInteractionDoorKnock.createMany({
          data: [
            {
              organizationSlug: orgSlug,
              personId: PERSON_1,
              occurredAt: new Date('2026-06-01T10:00:00Z'),
              outcome: 'not_home',
            },
            {
              organizationSlug: orgSlug,
              personId: PERSON_1,
              occurredAt: new Date('2026-07-01T10:00:00Z'),
              outcome: 'refused_to_engage',
            },
            {
              organizationSlug: orgSlug,
              personId: PERSON_1,
              occurredAt: new Date('2026-06-15T10:00:00Z'),
              outcome: 'answered',
              supportAnswer: 'supporter',
              note: 'Wants a yard sign',
            },
          ],
        })

        const { res } = await knockAndServe()

        expect(historyFor(res, PERSON_1)).toEqual([
          {
            type: 'DOOR_KNOCK',
            date: '2026-07-01T10:00:00.000Z',
            data: expect.objectContaining({ outcome: 'refused_to_engage' }),
          },
          {
            type: 'DOOR_KNOCK',
            date: '2026-06-15T10:00:00.000Z',
            data: expect.objectContaining({
              outcome: 'answered',
              supportAnswer: 'supporter',
              note: 'Wants a yard sign',
            }),
          },
          {
            type: 'DOOR_KNOCK',
            date: '2026-06-01T10:00:00.000Z',
            data: expect.objectContaining({ outcome: 'not_home' }),
          },
        ])
      })

      // The whole reason this is keyed by personId. Two people behind one
      // door disagree, and reading a housemate's refusal onto whoever opens
      // it is worse than showing nothing at all.
      it('scopes the feed to the resident, not the household', async () => {
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
              personId: PERSON_2,
              occurredAt: new Date('2026-07-02T10:00:00Z'),
              outcome: 'refused_to_engage',
            },
          ],
        })

        const { res } = await knockAndServe()

        // PERSON_1 and PERSON_2 share PIPED_KEY — one address, one door.
        expect(historyFor(res, PERSON_1)).toMatchObject([
          { data: { outcome: 'answered' } },
        ])
        expect(historyFor(res, PERSON_2)).toMatchObject([
          { data: { outcome: 'refused_to_engage' } },
        ])
      })

      it('merges the other CRM channels in the same vocabulary', async () => {
        await service.prisma.contactInteractionText.create({
          data: {
            organizationSlug: orgSlug,
            personId: PERSON_1,
            occurredAt: new Date('2026-07-03T10:00:00Z'),
            respondedAt: new Date('2026-07-03T11:00:00Z'),
          },
        })
        await service.prisma.contactInteractionRobocall.create({
          data: {
            organizationSlug: orgSlug,
            personId: PERSON_1,
            occurredAt: new Date('2026-07-02T10:00:00Z'),
            voicemailLeftAt: new Date('2026-07-02T10:01:00Z'),
          },
        })
        // ENG-10944: phone banking is a household-fanned-out channel like
        // door knocking — this asserts a phone-banked household member's
        // call shows up in their own history, in the same merged vocabulary
        // as text/robocall/status-change.
        await service.prisma.contactInteractionPhoneBanking.create({
          data: {
            organizationSlug: orgSlug,
            personId: PERSON_1,
            occurredAt: new Date('2026-07-01T10:00:00Z'),
            outcome: 'answered',
            supportAnswer: 'supporter',
            actorUserId: service.user.id,
          },
        })
        await service.prisma.contactStatusEvent.create({
          data: {
            organizationSlug: orgSlug,
            personId: PERSON_1,
            field: 'do_not_knock',
            fromValue: 'cleared',
            toValue: 'active',
            source: 'door_knock',
            actorUserId: service.user.id,
            createdAt: new Date('2026-07-04T10:00:00Z'),
          },
        })

        const { res } = await knockAndServe()

        const history = historyFor(res, PERSON_1)
        expect(history?.map((entry) => entry.type)).toEqual([
          'STATUS_CHANGE',
          'TEXT',
          'ROBOCALL',
          'PHONE_BANKING',
        ])
        // The labels are resolveContactStatusLabel's, the same ones the CRM
        // person view renders — not a door-knocking translation of the enum.
        expect(history?.[0]).toMatchObject({
          data: { fromLabel: 'Off', toLabel: 'On' },
        })
        expect(history?.[3]).toMatchObject({
          data: {
            outcome: 'answered',
            supportAnswer: 'supporter',
            actorName: 'Johnny Goodparty',
            actorUserId: service.user.id,
          },
        })
      })

      // The cap is what keeps the payload's cost independent of how long a
      // person's CRM history runs — see ADR 0009's measurements.
      it(`caps a long history at ${ROUTE_TARGET_ACTIVITY_LIMIT} rows, keeping the newest`, async () => {
        await service.prisma.contactInteractionText.createMany({
          data: Array.from({ length: 12 }, (_, index) => ({
            organizationSlug: orgSlug,
            personId: PERSON_1,
            occurredAt: new Date(
              `2026-07-${String(index + 1).padStart(2, '0')}T10:00:00Z`,
            ),
          })),
        })

        const { res } = await knockAndServe()

        const history = historyFor(res, PERSON_1)
        expect(history).toHaveLength(ROUTE_TARGET_ACTIVITY_LIMIT)
        expect(history?.[0]?.date).toBe('2026-07-12T10:00:00.000Z')
        expect(history?.[ROUTE_TARGET_ACTIVITY_LIMIT - 1]?.date).toBe(
          '2026-07-08T10:00:00.000Z',
        )
      })

      it("never leaks another organization's history", async () => {
        const otherSlug = `campaign-elsewhere-${Date.now()}`
        await service.prisma.organization.create({
          data: {
            slug: otherSlug,
            ownerId: service.user.id,
            overrideDistrictId: DISTRICT_ID,
          },
        })
        await service.prisma.contactInteractionDoorKnock.create({
          data: {
            organizationSlug: otherSlug,
            personId: PERSON_1,
            occurredAt: new Date('2026-07-01T10:00:00Z'),
            outcome: 'answered',
            supportAnswer: 'supporter',
          },
        })

        const { res } = await knockAndServe()

        expect(historyFor(res, PERSON_1)).toEqual([])
      })
    })

    // ADR 0011. Notes ride the payload for the reason the feed does: the
    // at-the-door sheet is fetch-free, so anything it cannot show from what
    // the walk opened with is not there when a canvasser is out of signal.
    describe('resident notes (ADR 0011)', () => {
      const notesFor = (res: { data: { stops: unknown } }, personId: string) =>
        (
          res.data.stops as Array<{
            addresses: Array<{
              targets: Array<{
                personId: string
                notes: {
                  entries: Array<{
                    id: string
                    personId: string
                    body: string
                    createdAt: string
                    updatedAt: string
                  }>
                  total: number
                }
              }>
            }>
          }>
        )
          .flatMap((stop) => stop.addresses)
          .flatMap((address) => address.targets)
          .find((target) => target.personId === personId)?.notes

      const writeNotes = (
        personId: string,
        notes: Array<{ body: string; createdAt: string; updatedAt?: string }>,
      ) =>
        service.prisma.contactNote.createMany({
          data: notes.map((note) => ({
            organizationSlug: orgSlug,
            personId,
            body: note.body,
            createdAt: new Date(note.createdAt),
            updatedAt: new Date(note.updatedAt ?? note.createdAt),
          })),
        })

      // Empty and absent are different claims, and this is the one that pins
      // it: the server always sends the block, so a missing `notes` key means
      // "this payload predates the field" rather than "nobody wrote anything".
      it('serves an empty block for a resident with no notes', async () => {
        const { res } = await knockAndServe()

        expect(res.status).toBe(200)
        expect(notesFor(res, PERSON_2)).toEqual({ entries: [], total: 0 })
      })

      it('orders notes newest first, with both timestamps', async () => {
        await writeNotes(PERSON_1, [
          {
            body: 'Asked about the sidewalk repairs',
            createdAt: '2026-06-01T10:00:00Z',
          },
          {
            body: 'Dog in the front yard, use the side gate',
            createdAt: '2026-07-01T10:00:00Z',
            // An edited note keeps its place in the list — ordering is by when
            // it was written, so fixing a typo does not resurface an old note.
            updatedAt: '2026-07-20T09:30:00Z',
          },
          { body: 'Wants a yard sign', createdAt: '2026-06-15T10:00:00Z' },
        ])

        const { res } = await knockAndServe()

        expect(notesFor(res, PERSON_1)).toMatchObject({
          total: 3,
          entries: [
            {
              body: 'Dog in the front yard, use the side gate',
              createdAt: '2026-07-01T10:00:00.000Z',
              updatedAt: '2026-07-20T09:30:00.000Z',
            },
            {
              body: 'Wants a yard sign',
              createdAt: '2026-06-15T10:00:00.000Z',
              updatedAt: '2026-06-15T10:00:00.000Z',
            },
            {
              body: 'Asked about the sidewalk repairs',
              createdAt: '2026-06-01T10:00:00.000Z',
            },
          ],
        })
      })

      // The id is what makes the note editable and deletable from the door,
      // and it is the CRM's own row id rather than anything derived here — the
      // webapp posts it straight back to `PATCH/DELETE contacts/notes/:id`.
      it('carries the CRM note id and personId through unchanged', async () => {
        await writeNotes(PERSON_1, [
          { body: 'Back door only', createdAt: '2026-07-01T10:00:00Z' },
        ])
        const saved = await service.prisma.contactNote.findFirstOrThrow({
          where: { organizationSlug: orgSlug, personId: PERSON_1 },
        })

        const { res } = await knockAndServe()

        expect(notesFor(res, PERSON_1)?.entries[0]).toMatchObject({
          id: saved.id,
          personId: PERSON_1,
        })
      })

      // The same reason the feed is keyed by personId: two people behind one
      // door are two records, and free text written about one of them read
      // against the other is worse material to get wrong than an outcome.
      it('scopes notes to the resident, not the household', async () => {
        await writeNotes(PERSON_1, [
          {
            body: 'Supportive, wants a sign',
            createdAt: '2026-07-01T10:00:00Z',
          },
        ])
        await writeNotes(PERSON_2, [
          {
            body: 'Asked us not to come back',
            createdAt: '2026-07-02T10:00:00Z',
          },
        ])

        const { res } = await knockAndServe()

        // PERSON_1 and PERSON_2 share PIPED_KEY — one address, one door.
        expect(notesFor(res, PERSON_1)?.entries.map((n) => n.body)).toEqual([
          'Supportive, wants a sign',
        ])
        expect(notesFor(res, PERSON_2)?.entries.map((n) => n.body)).toEqual([
          'Asked us not to come back',
        ])
      })

      // The cap bounds the payload; `total` is what stops the capped list
      // reading as the whole record. Without it the sheet would show three
      // notes out of nine and say nothing about the other six.
      it(`caps at ${ROUTE_TARGET_NOTE_LIMIT} newest and reports the true total`, async () => {
        await writeNotes(
          PERSON_1,
          Array.from({ length: 9 }, (_, index) => ({
            body: `Note ${index + 1}`,
            createdAt: `2026-07-${String(index + 1).padStart(2, '0')}T10:00:00Z`,
          })),
        )

        const { res } = await knockAndServe()

        const notes = notesFor(res, PERSON_1)
        expect(notes?.entries).toHaveLength(ROUTE_TARGET_NOTE_LIMIT)
        expect(notes?.entries.map((n) => n.body)).toEqual([
          'Note 9',
          'Note 8',
          'Note 7',
        ])
        expect(notes?.total).toBe(9)
      })

      // A resident sitting exactly on the cap is the case a renderer inferring
      // truncation from `entries.length` gets wrong, so the payload has to be
      // unambiguous about it.
      it('reports no truncation for a resident sitting on the cap', async () => {
        await writeNotes(
          PERSON_1,
          Array.from({ length: ROUTE_TARGET_NOTE_LIMIT }, (_, index) => ({
            body: `Note ${index + 1}`,
            createdAt: `2026-07-0${index + 1}T10:00:00Z`,
          })),
        )

        const { res } = await knockAndServe()

        expect(notesFor(res, PERSON_1)?.total).toBe(ROUTE_TARGET_NOTE_LIMIT)
      })

      it("never leaks another organization's notes", async () => {
        const otherSlug = `campaign-notes-elsewhere-${Date.now()}`
        await service.prisma.organization.create({
          data: {
            slug: otherSlug,
            ownerId: service.user.id,
            overrideDistrictId: DISTRICT_ID,
          },
        })
        await service.prisma.contactNote.create({
          data: {
            organizationSlug: otherSlug,
            personId: PERSON_1,
            body: 'Another campaign wrote this',
          },
        })

        const { res } = await knockAndServe()

        expect(notesFor(res, PERSON_1)).toEqual({ entries: [], total: 0 })
      })

      // The serve is this feature's heaviest read and runs on every walk open
      // and every map open, so notes are fetched for the whole route at once.
      // One call carrying every target's personId is what rules out the
      // per-target fetch; the service turns that into a single windowed
      // statement rather than a query per person.
      it('reads every target in one call rather than one per target', async () => {
        const notesService = service.app.get(DoorKnockingNotesService)
        const spy = vi.spyOn(notesService, 'notesByPersonId')

        const { res } = await knockAndServe()

        expect(res.status).toBe(200)
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy.mock.calls[0]?.[1]).toEqual(
          expect.arrayContaining([PERSON_1, PERSON_2, PERSON_3, PERSON_4]),
        )
      })
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
      // Pro, so this proves cross-org isolation rather than the Pro gate.
      await service.prisma.campaign.create({
        data: {
          userId: service.user.id,
          slug: `campaign-other-c-${suffix}`,
          organizationSlug: otherSlug,
          isPro: true,
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

  // The rail's per-list counts. The requirement is not "three plausible
  // numbers" — it is that a list reads the same on the rail as it does in the
  // details sheet one tap later, so these assert the rail's counts against the
  // SERVE PAYLOAD's own derivation rather than against constants alone. The
  // constants are here too, so a change that breaks both sides identically
  // still fails.
  describe('turf counts', () => {
    const PERSON_1 = '00000001-1111-1111-1111-111111111111'
    const PERSON_2 = '00000002-1111-1111-1111-111111111111'
    const PERSON_3 = '00000003-1111-1111-1111-111111111111'
    const PERSON_4 = '00000004-1111-1111-1111-111111111111'

    type PayloadTarget = {
      personId: string
      knockStatus: string
      doNotKnock: boolean
      notAVoterReason?: string
    }
    type PayloadStop = { addresses: Array<{ targets: PayloadTarget[] }> }

    // `routeCounts.ts` in gp-webapp, transcribed: this is what the details
    // sheet and the walk view compute off the same payload. Kept as an
    // independent reference on purpose — gp-api cannot import the webapp
    // module, so the equivalence is asserted rather than assumed.
    const fromPayload = (stops: PayloadStop[]) => {
      const doors = stops.reduce(
        (total, stop) => total + stop.addresses.length,
        0,
      )
      const knockable = stops.flatMap((stop) =>
        stop.addresses.flatMap((address) =>
          address.targets.filter(
            (target) => !target.doNotKnock && !target.notAVoterReason,
          ),
        ),
      )
      return {
        doorCount: doors,
        peopleCount: knockable.length,
        loggedCount: knockable.filter(
          (target) => target.knockStatus !== 'unknown',
        ).length,
      }
    }

    const listTurfs = async () => {
      const res = await service.client.get(
        '/v1/door-knocking/turfs',
        orgHeaders(),
      )
      expect(res.status).toBe(200)
      return res.data as Array<{
        id: number
        locked: boolean
        doorCount: number | null
        peopleCount: number | null
        loggedCount: number | null
      }>
    }

    const serveRoute = async (turfId: number) => {
      const res = await service.client.get(
        `/v1/door-knocking/turfs/${turfId}/route`,
        orgHeaders(),
      )
      expect(res.status).toBe(200)
      return res.data.stops as PayloadStop[]
    }

    // Every way the three numbers can diverge from a naive count, in one
    // route: a shared door (doors < people), a do-not-knock resident and a
    // not-a-voter resident (people < targets), an answered-but-unsure knock
    // that derives back to `unknown` (logged < knocked), and a not-home knock
    // that counts as logged even though nobody was reached.
    const messyFixture = async () => {
      await service.prisma.contactCurrentStatus.createMany({
        data: [
          {
            organizationSlug: orgSlug,
            personId: PERSON_1,
            field: 'do_not_knock',
            value: 'active',
          },
          {
            organizationSlug: orgSlug,
            personId: PERSON_3,
            field: 'not_a_voter',
            value: 'moved',
          },
        ],
      })
      await service.prisma.contactInteractionDoorKnock.createMany({
        data: [
          // Logged: nobody was reached, but the door has an answer written
          // down, which is what "logged" means.
          {
            organizationSlug: orgSlug,
            personId: PERSON_2,
            occurredAt: new Date('2026-07-02T10:00:00Z'),
            outcome: 'not_home',
          },
          // NOT logged: `deriveKnockStatus` collapses answered-but-unsure to
          // `unknown` on purpose — the door is still worth knocking.
          {
            organizationSlug: orgSlug,
            personId: PERSON_4,
            occurredAt: new Date('2026-07-03T10:00:00Z'),
            outcome: 'answered',
            supportAnswer: 'unsure',
          },
          // A flagged resident's own knock: it must not reach `loggedCount`,
          // because they are not in `peopleCount` to begin with.
          {
            organizationSlug: orgSlug,
            personId: PERSON_1,
            occurredAt: new Date('2026-07-04T10:00:00Z'),
            outcome: 'answered',
            supportAnswer: 'supporter',
          },
        ],
      })
    }

    it('reports counts the details sheet derives identically for the same list', async () => {
      await messyFixture()
      const turf = await createTurf()
      stubVendors()
      expect((await knock(turf.id)).status).toBe(201)

      const stops = await serveRoute(turf.id)
      const [row] = await listTurfs()

      expect({
        doorCount: row?.doorCount,
        peopleCount: row?.peopleCount,
        loggedCount: row?.loggedCount,
      }).toEqual(fromPayload(stops))
      // Two people share PIPED_KEY at one coordinate, so three doors hold
      // four targets; the two flags drop two of them; one of the two
      // survivors has an answer written down.
      expect(row).toMatchObject({
        locked: true,
        doorCount: 3,
        peopleCount: 2,
        loggedCount: 1,
      })
    })

    // The point at which a naive count diverges, stated as a comparison
    // rather than a constant: the frozen route really does hold four targets.
    it('drops do-not-knock and not-a-voter residents from people, but not their doors', async () => {
      await messyFixture()
      const turf = await createTurf()
      stubVendors()
      await knock(turf.id)

      const frozenTargets = await service.prisma.doorKnockingStopTarget.count()
      const [row] = await listTurfs()

      expect(frozenTargets).toBe(4)
      expect(row?.peopleCount).toBe(2)
      // A flagged resident is still behind a door somebody walks past, and
      // the details sheet's roster still lists them — so the door count is
      // unmoved by the flags.
      expect(row?.doorCount).toBe(3)
      // PERSON_1 is flagged AND has a supporter knock on file. Counting them
      // would put `loggedCount` above `peopleCount`.
      expect(row?.loggedCount).toBe(1)
    })

    it('carries no counts on an unlocked list, and no zeroes either', async () => {
      const turf = await createTurf()

      const [before] = await listTurfs()
      expect(before).toMatchObject({
        locked: false,
        doorCount: null,
        peopleCount: null,
        loggedCount: null,
      })

      stubVendors()
      await knock(turf.id)

      const [after] = await listTurfs()
      expect(after).toMatchObject({ locked: true, doorCount: 3 })
    })

    // The cost rule. `serve` is the feature's heaviest read — a nested route
    // fetch, a people-api round trip and four CRM queries — so the rail must
    // never reach for it, and the aggregate behind the counts must not grow a
    // round trip per list.
    it('answers every list from one batched aggregate, never a serve per list', async () => {
      const countsService = service.app.get(DoorKnockingTurfCountsService)
      const serveService = service.app.get(DoorKnockingServeService)
      const forRoutes = vi.spyOn(countsService, 'forRoutes')
      const serve = vi.spyOn(serveService, 'serve')

      stubVendors()
      for (const name of ['Ash St', 'Birch Ave', 'Cedar Ln']) {
        await knock((await createTurf(name)).id)
      }

      const rows = await listTurfs()

      expect(rows).toHaveLength(3)
      expect(rows.every((row) => row.doorCount === 3)).toBe(true)
      expect(forRoutes).toHaveBeenCalledTimes(1)
      expect(forRoutes.mock.calls[0]?.[1]).toHaveLength(3)
      expect(serve).not.toHaveBeenCalled()
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
      // Pro, so this proves cross-org isolation rather than the Pro gate.
      await service.prisma.campaign.create({
        data: {
          userId: service.user.id,
          slug: `campaign-int-c-${suffix}`,
          organizationSlug: otherSlug,
          isPro: true,
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

    // ADR 0009. The walk patches its own cache so the card updates without a
    // refetch; this is the other half — a re-serve agrees with what the phone
    // already showed, so leaving and re-entering the walk doesn't drop it.
    it("the recorded knock shows up in that resident's feed on the next serve", async () => {
      const turf = await createTurf()
      stubVendors({ residents: { addresses: [] } })
      await knock(turf.id)
      const target =
        await service.prisma.doorKnockingStopTarget.findFirstOrThrow({
          orderBy: { id: 'asc' },
        })
      await record({
        stopTargetId: target.id,
        clientKey: CLIENT_KEY,
        outcome: 'answered',
        supportAnswer: 'supporter',
        note: 'Back after six',
      })

      const res = await service.client.get(
        `/v1/door-knocking/turfs/${turf.id}/route`,
        { ...orgHeaders(), validateStatus: () => true },
      )

      const history = (
        res.data.stops as Array<{
          addresses: Array<{
            targets: Array<{
              personId: string
              history: Array<{ type: string; data: { note: string | null } }>
            }>
          }>
        }>
      )
        .flatMap((s) => s.addresses)
        .flatMap((a) => a.targets)
        .find((t) => t.personId === target.personId)?.history

      expect(history).toMatchObject([
        {
          type: 'DOOR_KNOCK',
          data: { outcome: 'answered', note: 'Back after six' },
        },
      ])
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
    describe('do-not-knock (ADR 0007)', () => {
      const setDoNotKnock = (body: Record<string, unknown>) =>
        service.client.post('/v1/door-knocking/do-not-knock', body, {
          ...orgHeaders(),
          validateStatus: () => true,
        })

      // knockAndGetTarget drops the turf on the floor; the frozen-route
      // assertion needs it back.
      const knockAndGetTurfAndTarget = async () => {
        const turf = await createTurf()
        stubVendors()
        expect((await knock(turf.id)).status).toBe(201)
        const target =
          await service.prisma.doorKnockingStopTarget.findFirstOrThrow({
            orderBy: { id: 'asc' },
          })
        return { turf, target }
      }

      // stubVendors already replaced evaluate with a spy; read the last call
      // rather than the first, since building the fixture knocks once too.
      const lastEvaluateArg = () => {
        const { evaluate } = service.app.get(DoorKnockingPeopleApiService)
        const { calls } = (evaluate as unknown as ReturnType<typeof vi.fn>).mock
        return calls.at(-1)?.[0] as Record<string, unknown> | undefined
      }

      const currentFor = (personId: string) =>
        service.prisma.contactCurrentStatus.findFirst({
          where: {
            organizationSlug: orgSlug,
            personId,
            field: 'do_not_knock',
          },
        })

      it('flags a person, attributing it to the user who tapped it', async () => {
        const target = await knockAndGetTarget()

        const res = await setDoNotKnock({
          stopTargetId: target.id,
          value: 'active',
        })

        expect(res.status).toBe(201)
        expect(res.data).toEqual({
          personId: target.personId,
          doNotKnock: true,
        })

        const event = await service.prisma.contactStatusEvent.findFirstOrThrow({
          where: {
            organizationSlug: orgSlug,
            personId: target.personId,
            field: 'do_not_knock',
          },
        })
        expect(event).toMatchObject({
          fromValue: 'cleared',
          toValue: 'active',
          source: 'door_knock',
          // A person pressed a button, so unlike the willVote-derived events
          // above this one has an actor and no idempotency key.
          actorUserId: service.user.id,
          sourceId: null,
        })
        expect((await currentFor(target.personId))?.value).toBe('active')
      })

      // Reversal is the whole reason `cleared` is a value rather than a
      // deleted row: the log has to answer who lifted it and when.
      it('records the reversal rather than erasing the flag', async () => {
        const target = await knockAndGetTarget()
        await setDoNotKnock({ stopTargetId: target.id, value: 'active' })

        const res = await setDoNotKnock({
          stopTargetId: target.id,
          value: 'cleared',
        })

        expect(res.status).toBe(201)
        expect(res.data).toEqual({
          personId: target.personId,
          doNotKnock: false,
        })

        const events = await service.prisma.contactStatusEvent.findMany({
          where: {
            organizationSlug: orgSlug,
            personId: target.personId,
            field: 'do_not_knock',
          },
          orderBy: { createdAt: 'asc' },
        })
        expect(events.map((e) => [e.fromValue, e.toValue])).toEqual([
          ['cleared', 'active'],
          ['active', 'cleared'],
        ])
        expect((await currentFor(target.personId))?.value).toBe('cleared')
      })

      // The seed is `cleared`, so this is a no-op rather than a logged
      // transition that never happened.
      it('writes nothing when clearing a person who was never flagged', async () => {
        const target = await knockAndGetTarget()

        const res = await setDoNotKnock({
          stopTargetId: target.id,
          value: 'cleared',
        })

        expect(res.status).toBe(201)
        expect(res.data).toEqual({
          personId: target.personId,
          doNotKnock: false,
        })
        expect(
          await service.prisma.contactStatusEvent.findMany({
            where: { organizationSlug: orgSlug, field: 'do_not_knock' },
          }),
        ).toHaveLength(0)
      })

      // Holding a stopTargetId proves nothing on its own; resolving it under
      // the caller's org is the authorization.
      it('404s on a stop target belonging to another org', async () => {
        const target = await knockAndGetTarget()
        const otherSlug = `campaign-dk-other-${Date.now()}`
        await service.prisma.organization.create({
          data: {
            slug: otherSlug,
            ownerId: service.user.id,
            overrideDistrictId: DISTRICT_ID,
          },
        })

        const res = await service.client.post(
          '/v1/door-knocking/do-not-knock',
          { stopTargetId: target.id, value: 'active' },
          {
            headers: { 'x-organization-slug': otherSlug },
            validateStatus: () => true,
          },
        )

        expect(res.status).toBe(404)
        expect(await currentFor(target.personId)).toBeNull()
      })

      it('rejects a value outside the vocabulary', async () => {
        const target = await knockAndGetTarget()

        const res = await setDoNotKnock({
          stopTargetId: target.id,
          value: 'maybe',
        })

        expect(res.status).toBe(400)
      })

      // Suppression happens at evaluation, which a frozen route has already
      // passed, so the walk view has to read the flag live instead.
      it('marks a flagged person on an already-frozen route', async () => {
        const { turf, target } = await knockAndGetTurfAndTarget()
        await setDoNotKnock({ stopTargetId: target.id, value: 'active' })

        const res = await service.client.get(
          `/v1/door-knocking/turfs/${turf.id}/route`,
          { ...orgHeaders(), validateStatus: () => true },
        )

        expect(res.status).toBe(200)
        const targets = (
          res.data.stops as Array<{
            addresses: Array<{
              targets: Array<{ personId: string; doNotKnock: boolean }>
            }>
          }>
        )
          .flatMap((s) => s.addresses)
          .flatMap((a) => a.targets)
        expect(
          targets.find((t) => t.personId === target.personId)?.doNotKnock,
        ).toBe(true)
        // Everyone else on the same route is untouched.
        expect(
          targets
            .filter((t) => t.personId !== target.personId)
            .every((t) => t.doNotKnock === false),
        ).toBe(true)
      })

      // The point of the whole feature: the next list must not contain them.
      it('keeps flagged people out of a newly built route', async () => {
        const target = await knockAndGetTarget()
        await setDoNotKnock({ stopTargetId: target.id, value: 'active' })

        const secondTurf = await createTurf('Second turf')
        expect((await knock(secondTurf.id)).status).toBe(201)

        expect(lastEvaluateArg()).toMatchObject({
          excludePersonIds: [target.personId],
        })
      })

      // The empty case is asserted against the DTO the adapter actually builds,
      // in doorKnockingPeopleApi.service.test.ts. Spying here sees only what
      // this route handed the adapter, which is the value under test's input
      // rather than its output.
    })
    describe('not-a-voter (ADR 0008)', () => {
      const setNotAVoter = (body: Record<string, unknown>) =>
        service.client.post('/v1/door-knocking/not-a-voter', body, {
          ...orgHeaders(),
          validateStatus: () => true,
        })

      const setDoNotKnock = (body: Record<string, unknown>) =>
        service.client.post('/v1/door-knocking/do-not-knock', body, {
          ...orgHeaders(),
          validateStatus: () => true,
        })

      const knockAndGetTurfAndTargets = async () => {
        const turf = await createTurf()
        stubVendors()
        expect((await knock(turf.id)).status).toBe(201)
        const targets = await service.prisma.doorKnockingStopTarget.findMany({
          orderBy: { id: 'asc' },
        })
        return { turf, targets }
      }

      const lastEvaluateArg = () => {
        const { evaluate } = service.app.get(DoorKnockingPeopleApiService)
        const { calls } = (evaluate as unknown as ReturnType<typeof vi.fn>).mock
        return calls.at(-1)?.[0] as Record<string, unknown> | undefined
      }

      const currentFor = (personId: string) =>
        service.prisma.contactCurrentStatus.findFirst({
          where: {
            organizationSlug: orgSlug,
            personId,
            field: 'not_a_voter',
          },
        })

      const eventsFor = (personId: string) =>
        service.prisma.contactStatusEvent.findMany({
          where: {
            organizationSlug: orgSlug,
            personId,
            field: 'not_a_voter',
          },
          orderBy: { createdAt: 'asc' },
        })

      it('records the reason, attributing it to the user who tapped it', async () => {
        const target = await knockAndGetTarget()

        const res = await setNotAVoter({
          stopTargetId: target.id,
          value: 'moved',
        })

        expect(res.status).toBe(201)
        expect(res.data).toEqual({
          personId: target.personId,
          notAVoterReason: 'moved',
        })

        const [event] = await eventsFor(target.personId)
        expect(event).toMatchObject({
          fromValue: 'cleared',
          toValue: 'moved',
          source: 'door_knock',
          // A person pressed a button, so it has an actor and no idempotency
          // key — a correction on a later visit has to be able to reach this.
          actorUserId: service.user.id,
          sourceId: null,
        })
        expect((await currentFor(target.personId))?.value).toBe('moved')
      })

      // Nothing is removed: the whole point of recording a reason instead of
      // acting on the prototype's phrasing. The person stays on the frozen
      // route, keeps their stop target, and keeps whatever was logged at the
      // door before.
      it('leaves the frozen route and the interaction history intact', async () => {
        const target = await knockAndGetTarget()
        expect(
          (
            await record({
              stopTargetId: target.id,
              clientKey: CLIENT_KEY,
              outcome: 'not_a_voter',
            })
          ).status,
        ).toBe(201)

        await setNotAVoter({ stopTargetId: target.id, value: 'deceased' })

        expect(
          await service.prisma.doorKnockingStopTarget.findUnique({
            where: { id: target.id },
          }),
        ).not.toBeNull()
        expect(
          await service.prisma.contactInteractionDoorKnock.count({
            where: { organizationSlug: orgSlug, personId: target.personId },
          }),
        ).toBe(1)
      })

      // The two answers are exclusive, so the second replaces the first rather
      // than sitting beside it — the reason they share one field.
      it('replaces one reason with the other, recording the correction', async () => {
        const target = await knockAndGetTarget()
        await setNotAVoter({ stopTargetId: target.id, value: 'moved' })

        const res = await setNotAVoter({
          stopTargetId: target.id,
          value: 'deceased',
        })

        expect(res.data).toEqual({
          personId: target.personId,
          notAVoterReason: 'deceased',
        })
        expect(
          (await eventsFor(target.personId)).map((e) => [
            e.fromValue,
            e.toValue,
          ]),
        ).toEqual([
          ['cleared', 'moved'],
          ['moved', 'deceased'],
        ])
        expect((await currentFor(target.personId))?.value).toBe('deceased')
      })

      // A mis-tapped 'deceased' is the worst mistake here and the most
      // foreseeable one. Lifting it is recorded rather than erased, so "who
      // un-flagged a dead person, and when" still has an answer.
      it('records the reversal rather than erasing the flag', async () => {
        const target = await knockAndGetTarget()
        await setNotAVoter({ stopTargetId: target.id, value: 'deceased' })

        const res = await setNotAVoter({
          stopTargetId: target.id,
          value: 'cleared',
        })

        expect(res.status).toBe(201)
        // No reason left to render: `cleared` comes back as an absent key.
        expect(res.data).toEqual({ personId: target.personId })
        expect(
          (await eventsFor(target.personId)).map((e) => [
            e.fromValue,
            e.toValue,
          ]),
        ).toEqual([
          ['cleared', 'deceased'],
          ['deceased', 'cleared'],
        ])
        expect((await currentFor(target.personId))?.value).toBe('cleared')
      })

      // The seed is `cleared`, so this is a no-op rather than a logged
      // transition that never happened.
      it('writes nothing when clearing a person who was never flagged', async () => {
        const target = await knockAndGetTarget()

        const res = await setNotAVoter({
          stopTargetId: target.id,
          value: 'cleared',
        })

        expect(res.status).toBe(201)
        expect(res.data).toEqual({ personId: target.personId })
        expect(await eventsFor(target.personId)).toHaveLength(0)
      })

      it('404s on a stop target belonging to another org', async () => {
        const target = await knockAndGetTarget()
        const otherSlug = `campaign-nav-other-${Date.now()}`
        await service.prisma.organization.create({
          data: {
            slug: otherSlug,
            ownerId: service.user.id,
            overrideDistrictId: DISTRICT_ID,
          },
        })

        const res = await service.client.post(
          '/v1/door-knocking/not-a-voter',
          { stopTargetId: target.id, value: 'moved' },
          {
            headers: { 'x-organization-slug': otherSlug },
            validateStatus: () => true,
          },
        )

        expect(res.status).toBe(404)
        expect(await currentFor(target.personId)).toBeNull()
      })

      it('rejects a value outside the vocabulary', async () => {
        const target = await knockAndGetTarget()

        const res = await setNotAVoter({
          stopTargetId: target.id,
          value: 'jailed',
        })

        expect(res.status).toBe(400)
      })

      // Suppression happens at evaluation, which a frozen route has already
      // passed, so the walk view reads the reason live — and gets the reason
      // rather than a boolean, because "moved away" and "deceased" call for
      // very different tone at a door the rest of the household still lives at.
      it('marks a flagged person on an already-frozen route', async () => {
        const { turf, targets } = await knockAndGetTurfAndTargets()
        const flagged = targets[0]!
        await setNotAVoter({ stopTargetId: flagged.id, value: 'deceased' })

        const res = await service.client.get(
          `/v1/door-knocking/turfs/${turf.id}/route`,
          { ...orgHeaders(), validateStatus: () => true },
        )

        expect(res.status).toBe(200)
        const served = (
          res.data.stops as Array<{
            addresses: Array<{
              targets: Array<{ personId: string; notAVoterReason?: string }>
            }>
          }>
        )
          .flatMap((s) => s.addresses)
          .flatMap((a) => a.targets)
        // Still on the route — the paper list in someone's hand cannot change.
        expect(served).toHaveLength(4)
        expect(
          served.find((t) => t.personId === flagged.personId)?.notAVoterReason,
        ).toBe('deceased')
        expect(
          served
            .filter((t) => t.personId !== flagged.personId)
            .every((t) => t.notAVoterReason === undefined),
        ).toBe(true)
      })

      // The point of the feature, and the ADR 0007 trap: this turf's saved
      // list carries no filters at all, which is exactly the case where an
      // `idOverrides`-shaped exclusion would contribute nothing. Both reasons
      // suppress, and a person who is also do-not-knock appears once.
      it('keeps flagged people out of a fresh evaluation, filters or not', async () => {
        const { targets } = await knockAndGetTurfAndTargets()
        const [moved, deceased, alsoDoNotKnock] = targets
        await setNotAVoter({ stopTargetId: moved!.id, value: 'moved' })
        await setNotAVoter({ stopTargetId: deceased!.id, value: 'deceased' })
        await setNotAVoter({
          stopTargetId: alsoDoNotKnock!.id,
          value: 'deceased',
        })
        await setDoNotKnock({
          stopTargetId: alsoDoNotKnock!.id,
          value: 'active',
        })

        const secondTurf = await createTurf('Second turf')
        expect((await knock(secondTurf.id)).status).toBe(201)

        const evaluateArg = lastEvaluateArg()
        // The saved list is bare, so nothing rides the filter-borne slots —
        // the SQL half of that trap is asserted in
        // voterDoorKnocking.service.test.ts.
        expect(
          (evaluateArg?.filters as Record<string, unknown> | undefined)?.id,
        ).toBeUndefined()
        const excluded = evaluateArg?.excludePersonIds as string[]
        expect([...excluded].sort()).toEqual(
          [
            moved!.personId,
            deceased!.personId,
            alsoDoNotKnock!.personId,
          ].sort(),
        )
      })

      // A cleared flag stops suppressing, which is what makes the reversal
      // more than an audit entry.
      it('stops suppressing once the flag is cleared', async () => {
        const target = await knockAndGetTarget()
        await setNotAVoter({ stopTargetId: target.id, value: 'moved' })
        await setNotAVoter({ stopTargetId: target.id, value: 'cleared' })

        const secondTurf = await createTurf('Reinstated turf')
        expect((await knock(secondTurf.id)).status).toBe(201)

        expect(lastEvaluateArg()?.excludePersonIds).toEqual([])
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

  // ADR 0010. The knock's own evaluation, run without the vendor call, so the
  // draw step can name the doors before anything is bought.
  describe('address preview', () => {
    const previewOpts = () => ({ ...orgHeaders(), validateStatus: () => true })

    const preview = (body: Record<string, unknown> = {}) =>
      service.client.post(
        '/v1/door-knocking/address-preview',
        { geoPoly: GEO_POLY, filters: {}, ...body },
        previewOpts(),
      )

    const lastEvaluateArg = () => {
      const { evaluate } = service.app.get(DoorKnockingPeopleApiService)
      const { calls } = (evaluate as unknown as ReturnType<typeof vi.fn>).mock
      return calls.at(-1)?.[0] as Record<string, unknown> | undefined
    }

    // A second unit at the first building's coordinate: one stop the router
    // visits, two doors a canvasser knocks. The whole reason the preview
    // reports stops and doors as different numbers.
    const OTHER_UNIT_KEY = '1200|W|ELM|ST||4A|62704'

    it('lists unit addresses by stop, on the counts the freeze would produce', async () => {
      stubVendors({
        people: [
          person(1, 41.9, -87.65, PIPED_KEY),
          person(2, 41.9, -87.65, PIPED_KEY),
          person(3, 41.9, -87.65, OTHER_UNIT_KEY),
          person(4, 41.901, -87.651),
          bboxOnlyPerson,
        ],
      })

      const res = await preview()

      expect(res.status).toBe(201)
      // Two coordinates survive the ray-cast — the bbox-only person is
      // dropped, so neither their stop nor their door is counted anywhere.
      // Addresses render through the same helper the frozen route uses, so
      // the door previewed here and the door walked later read identically.
      expect(res.data).toEqual({
        stops: 2,
        doors: 3,
        people: 4,
        locations: [
          {
            doors: [
              { address: '1200 W ELM ST Apt 3B', people: 2 },
              { address: '1200 W ELM ST Apt 4A', people: 1 },
            ],
          },
          { doors: [{ address: 'KEY-4', people: 1 }] },
        ],
      })
    })

    // A shape drawn over nothing is an ordinary moment in drawing, not a
    // failure — the knock 400s here because it is committing a turf.
    it('answers an empty shape with zeros instead of the knock 400', async () => {
      stubVendors({ people: [] })

      const res = await preview()

      expect(res.status).toBe(201)
      expect(res.data).toEqual({
        stops: 0,
        doors: 0,
        people: 0,
        locations: [],
      })
    })

    it('asks evaluation to drop the org suppressed people (ADR 0007/0008)', async () => {
      const turf = await createTurf()
      stubVendors()
      expect((await knock(turf.id)).status).toBe(201)
      const target =
        await service.prisma.doorKnockingStopTarget.findFirstOrThrow({
          orderBy: { id: 'asc' },
        })
      await service.client.post(
        '/v1/door-knocking/do-not-knock',
        { stopTargetId: target.id, value: 'active' },
        previewOpts(),
      )

      expect((await preview()).status).toBe(201)

      // The exclusion is a WHERE clause, and its SQL half is asserted in
      // voterDoorKnocking.service.test.ts; what matters here is that the
      // preview asks for it at all. A door whose every resident is flagged
      // therefore has nobody to evaluate and never reaches the list — the
      // route built from this shape would not contain it either.
      expect(lastEvaluateArg()).toMatchObject({
        excludePersonIds: [target.personId],
      })
    })

    // The saved list is resolved through the identical three steps the knock
    // runs, so a draft carrying activity conditions previews the audience it
    // will knock rather than the one convertVoterFileFilterToFilters alone
    // would produce.
    it('resolves the draft filters and bounds the scan by the ring bbox', async () => {
      stubVendors()

      expect((await preview({ filters: { partyDemocrat: true } })).status).toBe(
        201,
      )

      const arg = lastEvaluateArg()
      expect(arg?.districtId).toBe(DISTRICT_ID)
      expect(arg?.bbox).toEqual({
        minLat: 41.89,
        maxLat: 41.91,
        minLng: -87.66,
        maxLng: -87.64,
      })
    })

    it('spends no vendor credit and freezes nothing', async () => {
      const fetchSpy = stubVendors()

      expect((await preview()).status).toBe(201)

      expect(
        fetchSpy.mock.calls.filter(([url]) =>
          String(url).includes('routeplanner'),
        ),
      ).toHaveLength(0)
      expect(await service.prisma.doorKnockingRoute.count()).toBe(0)
      expect(await service.prisma.doorKnockingStop.count()).toBe(0)
      expect(await service.prisma.doorKnockingRoutePlannerSpend.count()).toBe(0)
    })

    // The counts are the draw step's only figures once a preview exists, so
    // the cap must bound what is materialized without bounding what is
    // reported — a shape the candidate has to shrink still has to say by how
    // much.
    it('caps the listing at the stop limit while still counting every stop', async () => {
      const crowd = Array.from({ length: 160 }, (_, index) =>
        person(index + 1, 41.895, -87.655 + index * 0.00005, `KEY-${index}`),
      )
      stubVendors({ people: crowd })

      const res = await preview()

      expect(res.status).toBe(201)
      expect(res.data.stops).toBe(160)
      expect(res.data.doors).toBe(160)
      expect(res.data.locations).toHaveLength(150)
      // Whole locations only: every listed stop shows all of its doors.
      expect(
        (res.data.locations as Array<{ doors: unknown[] }>).every(
          (location) => location.doors.length === 1,
        ),
      ).toBe(true)
    })
  })

  describe('Pro gate (ENG-10888)', () => {
    const downgrade = () =>
      service.prisma.campaign.update({
        where: { id: campaign.id },
        data: { isPro: false },
      })

    // Every route the gate covers, as (method, path, body) so one loop can
    // prove the refusal is uniform. Bodies are valid on purpose: the
    // @Body ZodValidationPipe runs before the method body, so a malformed one
    // would 400 as 'Validation failed' and prove nothing about the gate.
    const gatedRoutes = (turfId: number) =>
      [
        [
          'post',
          '/v1/door-knocking/turfs',
          {
            voterFileFilterId: filter.id,
            name: 'Gated turf',
            color: '#22aa55',
            geoPoly: GEO_POLY,
          },
        ],
        ['get', '/v1/door-knocking/turfs', undefined],
        ['get', `/v1/door-knocking/turfs/${turfId}`, undefined],
        ['put', `/v1/door-knocking/turfs/${turfId}`, { name: 'Renamed' }],
        ['get', `/v1/door-knocking/turfs/${turfId}/route`, undefined],
        ['get', '/v1/door-knocking/pack', undefined],
        // ADR 0010: a read of voter data, so it is gated with the rest.
        [
          'post',
          '/v1/door-knocking/address-preview',
          { geoPoly: GEO_POLY, filters: {} },
        ],
        [
          'post',
          '/v1/door-knocking/interactions',
          {
            stopTargetId: 1,
            clientKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            outcome: 'answered',
          },
        ],
        [
          'post',
          `/v1/door-knocking/turfs/${turfId}/knock`,
          { mode: 'walk', loop: false },
        ],
        // After the knock above, so both find a route and exercise their real
        // path rather than the not-yet-knocked 409. `complete` takes no body
        // but still needs `{}`: the loop below only passes headers as the
        // third argument, and axios reads a POST's second argument as data —
        // so `undefined` would send the headers as the payload and lose the
        // org, 404ing before the gate it is here to test.
        ['post', `/v1/door-knocking/turfs/${turfId}/complete`, {}],
        [
          'post',
          `/v1/door-knocking/turfs/${turfId}/archive`,
          { archived: true },
        ],
        // Last on purpose: the Pro-org loop below shares one turf, and a delete
        // in the middle would leave every route after it answering 404 without
        // ever reaching the gate under test. Order is irrelevant to the non-Pro
        // loop, which never gets past the gate at all.
        ['delete', `/v1/door-knocking/turfs/${turfId}`, undefined],
      ] as const

    const opts = () => ({ ...orgHeaders(), validateStatus: () => true })

    it('refuses every gated route for a non-Pro organization', async () => {
      const turf = await createTurf()
      await downgrade()

      for (const [method, path, body] of gatedRoutes(turf.id)) {
        const res =
          body === undefined
            ? await service.client[method](path, opts())
            : await service.client[method](path, body, opts())
        expect(res.status, `${method.toUpperCase()} ${path}`).toBe(400)
        expect(res.data.message, `${method.toUpperCase()} ${path}`).toBe(
          'This feature is only available for pro campaigns',
        )
      }
    })

    it('keeps every gated route open for a Pro organization', async () => {
      const turf = await createTurf()
      stubVendors()

      const list = await service.client.get('/v1/door-knocking/turfs', opts())
      expect(list.status).toBe(200)
      const get = await service.client.get(
        `/v1/door-knocking/turfs/${turf.id}`,
        opts(),
      )
      expect(get.status).toBe(200)

      // Then the whole list, asserted by the absence of the gate's own message
      // rather than by status. Run against a live Pro org most of these answer
      // 2xx, but a couple legitimately fail on their own terms — POST
      // /interactions carries a synthetic stopTargetId (404), and PUT meets
      // assertNotLocked once the knock above it has run (409). A status
      // assertion would be testing those reasons; this asserts exactly the one
      // thing the gate could get wrong, which is refusing an entitled org.
      for (const [method, path, body] of gatedRoutes(turf.id)) {
        const res =
          body === undefined
            ? await service.client[method](path, opts())
            : await service.client[method](path, body, opts())
        expect(res.data?.message, `${method.toUpperCase()} ${path}`).not.toBe(
          'This feature is only available for pro campaigns',
        )
      }
    })

    // The org lapsing mid-pilot is exactly the case the two holes exist for:
    // the route it was walking is now unreachable, but a canvasser standing at
    // a door that asked not to be revisited can still record that.
    it('still accepts both suppression writes after a downgrade', async () => {
      const turf = await createTurf()
      stubVendors()
      expect((await knock(turf.id)).status).toBe(201)
      const target =
        await service.prisma.doorKnockingStopTarget.findFirstOrThrow({
          orderBy: { id: 'asc' },
        })

      await downgrade()

      // The walk itself is gone...
      const route = await service.client.get(
        `/v1/door-knocking/turfs/${turf.id}/route`,
        opts(),
      )
      expect(route.status).toBe(400)

      // ...but "don't come back" and "wrong door" still land.
      const dnk = await service.client.post(
        '/v1/door-knocking/do-not-knock',
        { stopTargetId: target.id, value: 'active' },
        opts(),
      )
      expect(dnk.status).toBe(201)
      expect(dnk.data).toEqual({
        personId: target.personId,
        doNotKnock: true,
      })

      const nav = await service.client.post(
        '/v1/door-knocking/not-a-voter',
        { stopTargetId: target.id, value: 'moved' },
        opts(),
      )
      expect(nav.status).toBe(201)
      expect(nav.data).toEqual({
        personId: target.personId,
        notAVoterReason: 'moved',
      })
    })

    // hasElectedOfficeAccess keys on the `eo-` slug prefix and short-circuits
    // before isPro is read, so a Serve org is license-equivalent to Pro here
    // exactly as it is across the CRM.
    it('grants access to an eo- organization with no Pro campaign', async () => {
      const suffix = Date.now()
      const eoSlug = `eo-dk-gate-${suffix}`
      await service.prisma.organization.create({
        data: {
          slug: eoSlug,
          ownerId: service.user.id,
          overrideDistrictId: DISTRICT_ID,
        },
      })
      await service.prisma.campaign.create({
        data: {
          userId: service.user.id,
          slug: `eo-dk-gate-campaign-${suffix}`,
          organizationSlug: eoSlug,
          isPro: false,
        },
      })

      const res = await service.client.get('/v1/door-knocking/turfs', {
        headers: { 'x-organization-slug': eoSlug },
        validateStatus: () => true,
      })

      expect(res.status).toBe(200)
      expect(res.data).toEqual([])
    })
  })
})
