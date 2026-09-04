import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import {
  CreateDoorKnockingTurf,
  DoorKnockingTurf,
  GeoJsonPolygon,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { GeoapifyRoutePlannerService } from '@/vendors/geoapify/services/geoapifyRoutePlanner.service'
import type { LngLat } from '@/vendors/geoapify/services/geoapifyRoutePlanner.service'
import type { GeoapifyApi } from '@/vendors/geoapify/observability/geoapify.metrics'
import { recordGeoapifyCredits } from '@/vendors/geoapify/observability/geoapify.metrics'
import {
  ContactStatusField,
  DoNotKnockStatus,
  NotAVoterStatus,
  Organization,
  OutreachStatus,
  OutreachType,
} from '../../generated/prisma'
import { DoorKnockingPeopleApiService } from './doorKnockingPeopleApi.service'
import { DoorKnockingStatsService } from './doorKnockingStats.service'
import { DoorKnockingTurfService } from './doorKnockingTurf.service'
import { pointInPolygon, polygonBbox } from '../utils/geo.util'
import { routePlannerCredits, routingCredits } from '../utils/geoapifyCost.util'
import { assertCampaignQuota } from '../utils/campaignQuota.util'
import { recordWaypointSpend } from '../utils/waypointSpend.util'

// Leadership-approved hard cap; the DB CHECK on stop.seq enforces the same
// bound. Exported so the draw-step preview materializes addresses only up to
// the number of stops a savable list can hold, rather than carrying a second
// 150 that can drift from this one.
export const MAX_STOPS = 150
// The vendor call happens inside the transaction by design, so the timeout
// must absorb it.
const CREATE_TX_TIMEOUT_MS = 120_000

// What one create cost, kept split by API until the metric records it that
// way and totalled for everything else. The two rates have nothing in common,
// so a single number here would be a number nobody could take apart again.
type RouteCredits = Record<GeoapifyApi, number>

type EvaluatedPerson = {
  id: string
  firstName: string | null
  lastName: string | null
  lat: number
  lng: number
  addressKey: string
  displayAddress: string
}

type PlannedStop = {
  lat: number
  lng: number
  displayAddress: string
  people: EvaluatedPerson[]
}

type RouteRequest = {
  mode: CreateDoorKnockingTurf['mode']
  loop: CreateDoorKnockingTurf['loop']
}

// The envelope's scope, chosen by the caller rather than derived from whether
// the org happens to hold a Campaign. `campaignId: null` is what makes a row
// a Serve one, and an org mid-transition holds both — deriving it here is
// exactly the ENG-10976 leak. Same shape phone banking's list service takes.
export type DoorKnockingOutreachScope = {
  campaignId: number | null
  organizationSlug: string
}

// Creating a door-knocking list buys its route. Turf, route, stops, stop
// targets and the Outreach envelope are one transaction and one 1:1:1 chain —
// there is no saved-but-unrouted turf for a later Knock button to act on,
// which is what retired both the "locked" flag and the knock idempotency
// probe that used to guard a second purchase of the same turf.
//
// The advisory lock that knocking held is gone with it. It existed so two
// knocks of the SAME turf could not both call the vendor; a create always
// makes a new turf, so there is no shared row to serialize on. Two creates
// racing each other were never serialized anyway — see the quota note below,
// which is unchanged.
@Injectable()
export class DoorKnockingCreateService extends createPrismaBase(
  MODELS.DoorKnockingRoute,
) {
  constructor(
    private readonly peopleApi: DoorKnockingPeopleApiService,
    private readonly geoapify: GeoapifyRoutePlannerService,
    private readonly contacts: ContactsService,
    private readonly contactStatus: ContactStatusService,
    private readonly turfs: DoorKnockingTurfService,
    private readonly stats: DoorKnockingStatsService,
  ) {
    super()
  }

  // A Serve org's scope is no longer a reason to skip the envelope — it is
  // written scoped by organization alone. That conditional envelope is what
  // forced the list lifecycle onto the turf in the first place, since a Serve
  // org would otherwise have had nowhere to record it.
  async create(
    organization: Organization,
    scope: DoorKnockingOutreachScope,
    input: CreateDoorKnockingTurf,
    actorUserId: number,
  ): Promise<DoorKnockingTurf> {
    // Runs the same eligibility gate as every other voter-data read — a
    // Win campaign without downloadable voter data can't knock either.
    const districtId =
      await this.contacts.resolveEligibleDistrictId(organization)

    // ADR 0007 and ADR 0008. Read outside the transaction because they touch a
    // different table and would otherwise add two round trips to a critical
    // section that already contains a vendor call. Both sets are the org's own
    // flagged people, small by construction.
    //
    // One exclusion list, because evaluation has one job either way: leave
    // this person's door out of the route. Deduped because a person told
    // "don't come back" who also moved is two facts about one door.
    const [doNotKnockIds, notAVoterIds] = await Promise.all([
      this.contactStatus.personIdsByFieldValue(
        organization.slug,
        ContactStatusField.do_not_knock,
        [DoNotKnockStatus.active],
      ),
      this.contactStatus.personIdsByFieldValue(
        organization.slug,
        ContactStatusField.not_a_voter,
        [NotAVoterStatus.moved, NotAVoterStatus.deceased],
      ),
    ])
    const excludePersonIds = [...new Set([...doNotKnockIds, ...notAVoterIds])]

    const turfId = await this.client.$transaction(
      async (tx) => {
        const filter = await tx.voterFileFilter.findFirst({
          where: {
            id: input.voterFileFilterId,
            organizationSlug: organization.slug,
          },
          // activityConditions is a relation, so it has to be pulled in
          // explicitly — without it the resolution below sees a list with no
          // conditions and routes the unfiltered roster.
          include: { activityConditions: true },
        })
        if (!filter) {
          throw new NotFoundException('Voter file filter not found')
        }

        // The turf is inserted before the vendor call so the spend ledger can
        // name the turf that caused it, exactly as it did when the turf
        // already existed. The ledger holds a plain int and never joins, so a
        // rollback below leaving it pointing at an id that no longer exists is
        // the documented, intended behaviour: the money was still spent.
        const turf = await tx.doorKnockingTurf.create({
          data: {
            voterFileFilterId: filter.id,
            name: input.name,
            color: input.color,
            geoPoly: input.geoPoly,
          },
        })

        // The list's own saved filters, resolved exactly as the CRM resolves
        // them. Anything less and the list's activity conditions,
        // support-status, contacts-made and voter-likelihood overrides stop
        // applying the moment it is routed — the roster the candidate
        // previewed in Contacts and the roster they walk would quietly
        // disagree.
        const resolved = await this.contacts.resolveSavedFilterForQuery(
          organization,
          filter,
        )
        if (resolved.empty) {
          // Nobody survives the list's own filters, so there is nothing to
          // route. Same failure the polygon miss below reports, raised before
          // paying for a people-db scan that can only come back empty.
          throw new BadRequestException(
            'No matching voters inside this turf — widen the area or the filters',
          )
        }

        const { people } = await this.peopleApi.evaluate({
          districtId,
          bbox: polygonBbox(input.geoPoly),
          filters: resolved.filters,
          idOverrides: resolved.idOverrides,
          contactsMadeIdOverrides: resolved.contactsMadeIdOverrides,
          excludePersonIds,
        })
        const stops = this.buildStops(people, input.geoPoly)

        // Last gate before the only paid call in the system, and the sole
        // per-account limit: five campaigns a rolling day. A 500-stop daily
        // budget used to be checked here too and was removed — the per-org
        // stop cap is gone, and the shared credit pool is now bounded by the
        // account-wide alerts over the spend ledger rather than by rationing
        // each organization against it.
        //
        // The create flow refuses to open once this is spent, so reaching it
        // here means a teammate spent the day's allowance in between. It stays
        // as the authority: that read is advisory and this is the write.
        await assertCampaignQuota(tx, organization)

        const plan = await this.planStops(stops, input)

        // Priced off what the vendor was actually sent, not off stops.length:
        // the anchors are billed locations, the Route Planner's rate is
        // quadratic under ten of them, and the path-geometry fetch is a
        // second billed call whose waypoint count includes those anchors.
        // `routingWaypoints` is 0 when that call never completed, which is
        // the only thing that makes it free.
        const credits: RouteCredits = {
          route_planner: routePlannerCredits(plan.locations),
          routing: routingCredits(plan.routingWaypoints, plan.totalMeters),
        }

        // The vendor has been paid. Record it before anything below can fail,
        // and on `this.client` rather than `tx` so the ledger row survives a
        // rollback of the freeze — otherwise the budget forgets a call that
        // really happened and hands the same allowance out again.
        await this.recordSpend(
          organization.slug,
          turf.id,
          stops.length,
          credits,
        )

        const route = await tx.doorKnockingRoute.create({
          data: {
            doorKnockingTurfId: turf.id,
            mode: input.mode,
            loop: input.loop,
            totalSeconds: plan.totalSeconds,
            totalMeters: plan.totalMeters,
            credits: credits.route_planner + credits.routing,
            pathGeometry: plan.pathGeometry ?? undefined,
            stops: {
              create: plan.orderedJobIds.map((jobId, index) => {
                const stop = stops[Number(jobId)]!
                return {
                  seq: index + 1,
                  lat: stop.lat,
                  lng: stop.lng,
                  displayAddress: stop.displayAddress,
                  legSeconds: plan.legSeconds[index] ?? 0,
                  legMeters: plan.legMeters[index] ?? 0,
                  targets: {
                    create: stop.people.map((person) => ({
                      personId: person.id,
                      name:
                        [person.firstName, person.lastName]
                          .filter(Boolean)
                          .join(' ') || null,
                      addressKey: person.addressKey,
                    })),
                  },
                }
              }),
            },
          },
        })

        // First use of this filter locks it from edits, same as any other
        // outreach launch (first-write-wins, never rolled back).
        await tx.voterFileFilter.updateMany({
          where: { id: filter.id, firstUsedForOutreachAt: null },
          data: { firstUsedForOutreachAt: new Date() },
        })

        // The envelope is the walk: it carries the lifecycle and it is what
        // outreach surfaces list.
        await tx.outreach.create({
          data: {
            ...scope,
            outreachType: OutreachType.nativeDoorKnocking,
            status: OutreachStatus.in_progress,
            name: turf.name,
            voterFileFilterId: filter.id,
            doorKnockingRouteId: route.id,
            date: new Date(),
          },
        })

        return turf.id
      },
      { timeout: CREATE_TX_TIMEOUT_MS },
    )

    // Fired after the transaction commits so the rollup counts the turf that
    // was actually persisted, and void-and-caught so a Segment hiccup cannot
    // fail a create the vendor has already been paid for.
    void this.stats
      .emitCanvassingTotals(actorUserId, organization.slug)
      .catch(() => undefined)

    // Read back outside the transaction so the response is built by the one
    // function that builds every turf response, counts included — the new
    // list appears on the rail with the same shape it will have on reload.
    return this.turfs.get(turfId, organization.slug)
  }

  // A failed ledger write must not fail a purchase the vendor already billed,
  // so this logs and continues. The consequence of losing a row is an
  // under-count of the daily budget — far cheaper than rejecting paid work.
  private async recordSpend(
    organizationSlug: string,
    turfId: number,
    stops: number,
    credits: RouteCredits,
  ): Promise<void> {
    const billed = credits.route_planner + credits.routing

    // `waypoints` is stops and only stops, and it does not convert into
    // `credits`, which counts two APIs at two rates. Read this line for money
    // through `credits` and for size through `waypoints`; neither divides into
    // the other. Nothing is denominated in stops any more — the daily budget
    // that was is gone — so `waypoints` is here to say how big the route was,
    // not what it was allowed to be.
    //
    // Emitted before the ledger write and independently of its outcome: the
    // vendor has already billed, so this line — not the ledger — is what every
    // spend query and all five credit alerts actually count. A lost ledger row
    // must not be able to hide money that left. Carries organizationSlug so
    // per-org-per-day spend is queryable in Loki without the cardinality cost
    // of a Prometheus label, which is how a fired budget tier gets narrowed to
    // the organization that caused it.
    this.logger.info({
      event: 'DoorKnockingSpend',
      organizationSlug,
      turfId,
      waypoints: stops,
      credits: billed,
    })
    recordGeoapifyCredits('route_planner', credits.route_planner)
    recordGeoapifyCredits('routing', credits.routing)

    try {
      await recordWaypointSpend(this.client, {
        organizationSlug,
        doorKnockingTurfId: turfId,
        waypoints: stops,
        credits: billed,
      })
    } catch (error) {
      this.logger.error(
        { error, organizationSlug, turfId, stops },
        'failed to record door-knocking route planner spend',
      )
    }
  }

  private buildStops(
    people: EvaluatedPerson[],
    polygon: GeoJsonPolygon,
  ): PlannedStop[] {
    // Deterministic input order (addressKey, then person id) so the same
    // turf always yields the same stops, anchors, and vendor request.
    const inside = people
      .filter((person) => pointInPolygon(person.lng, person.lat, polygon))
      .sort(
        (a, b) =>
          a.addressKey.localeCompare(b.addressKey) || a.id.localeCompare(b.id),
      )
    if (inside.length === 0) {
      throw new BadRequestException(
        'No matching voters inside this turf — widen the area or the filters',
      )
    }

    const byCoordinate = new Map<string, PlannedStop>()
    for (const person of inside) {
      const key = `${person.lat}|${person.lng}`
      let stop = byCoordinate.get(key)
      if (!stop) {
        stop = {
          lat: person.lat,
          lng: person.lng,
          displayAddress: person.displayAddress,
          people: [],
        }
        byCoordinate.set(key, stop)
      }
      stop.people.push(person)
    }

    const stops = [...byCoordinate.values()]
    if (stops.length > MAX_STOPS) {
      throw new BadRequestException(
        `This turf has ${stops.length} stops — the maximum is ${MAX_STOPS}. ` +
          'Draw a smaller area or narrow the filters',
      )
    }
    return stops
  }

  private async planStops(stops: PlannedStop[], request: RouteRequest) {
    const jobs = stops.map((stop, index) => ({
      id: String(index),
      location: [stop.lng, stop.lat] as LngLat,
    }))

    // Anchors are deterministic, never random. Loop: start = end at the
    // first stop by address (a closed tour is the same cycle from anywhere,
    // so the anchor is cost-free). Open: end-only anchor at the stop
    // farthest from the centroid, letting the vendor pick the best start.
    let agent: { start_location?: LngLat; end_location?: LngLat }
    if (request.loop) {
      const anchorIndex = stops.reduce(
        (best, stop, index) =>
          stop.displayAddress.localeCompare(stops[best]!.displayAddress) < 0
            ? index
            : best,
        0,
      )
      const anchor = jobs[anchorIndex]!.location
      agent = { start_location: anchor, end_location: anchor }
    } else {
      const centroidLat =
        stops.reduce((sum, stop) => sum + stop.lat, 0) / stops.length
      const centroidLng =
        stops.reduce((sum, stop) => sum + stop.lng, 0) / stops.length
      const anchorIndex = stops.reduce((best, stop, index) => {
        const d = (s: PlannedStop) =>
          (s.lat - centroidLat) ** 2 + (s.lng - centroidLng) ** 2
        return d(stop) > d(stops[best]!) ? index : best
      }, 0)
      agent = { end_location: jobs[anchorIndex]!.location }
    }

    return this.geoapify.planRoute({ mode: request.mode, agent, jobs })
  }
}
