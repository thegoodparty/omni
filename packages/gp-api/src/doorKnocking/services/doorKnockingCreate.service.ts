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
import {
  GeoapifyRoutePlannerService,
  RoutePlanRejectedError,
} from '@/vendors/geoapify/services/geoapifyRoutePlanner.service'
import type {
  LngLat,
  RoutePlannerPlan,
} from '@/vendors/geoapify/services/geoapifyRoutePlanner.service'
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
import {
  type BlockFace,
  coordinateKey,
  groupIntoBlockFaces,
  metersBetween,
  representativeOf,
  sequenceBlockFaces,
} from '../utils/blockFace.util'
import {
  emptyAudienceMessage,
  emptyTurfMessage,
} from '../utils/emptyAudience.util'
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

// Geoapify rejects a WALKING request whose locations span more than this, with
// a 400 that our client would otherwise re-raise as a 502 — blaming the vendor
// for a request we should never have sent, and telling the candidate to wait
// for something that will never change. Measured against the live API rather
// than read off the docs: 99 km plans, 101 km returns "Too long distance
// between locations. Distance should not exceed 100000 meters for a regular
// API call". Driving has no equivalent cliff (120 km plans normally), so this
// gates one mode only.
const WALK_SPREAD_LIMIT_METERS = 100_000

// How many addresses a refusal names before it stops listing them. Long enough
// to show a pattern, short enough to stay a sentence.
const MAX_NAMED_UNROUTABLE = 3

// O(n²) over at most MAX_STOPS face representatives — about 11k equirectangular
// distances at the ceiling, which is nothing beside the vendor round trip it
// stands in front of. The approximation is the one metersBetween documents, and
// a threshold this coarse has no use for a better one.
const maxPairwiseMeters = (points: PlannedStop[]): number => {
  let max = 0
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const meters = metersBetween(points[i]!, points[j]!)
      if (meters > max) max = meters
    }
  }
  return max
}

// The answer a one-face turf's vendor call would have had, had the vendor been
// able to give one — see planStops. The single face is job 0 and there is no
// face before it to arrive from, so its incoming leg is zero exactly as the
// vendor reports a free-start first job. Both counts are zero because no call
// was made, which is the whole point: `locations` and `routingWaypoints` are
// what the ledger prices, and a request never sent is not owed for.
const SINGLE_FACE_PLAN: RoutePlannerPlan = {
  orderedJobIds: ['0'],
  legSeconds: [0],
  legMeters: [0],
  totalSeconds: 0,
  totalMeters: 0,
  locations: 0,
  routingWaypoints: 0,
  pathGeometry: null,
}

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
    // Which product's words a create failure speaks in. The `eo-` prefix is
    // the whole rule, the same way every other Serve answer resolves it.
    const isServe = organization.slug.startsWith('eo-')

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
            // Why the list was walked, kept on the turf beside the audience
            // it selected. Optional because every turf created before the
            // talking-points step existed has none, and because the wizard
            // does not require a purpose to route a walk.
            purpose: input.purpose,
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
          // route — and nothing about the polygon, which has not been looked
          // at yet, could change that. Raised before paying for a people-db
          // scan that can only come back empty.
          throw new BadRequestException(emptyAudienceMessage(filter, isServe))
        }

        const { people } = await this.peopleApi.evaluate({
          districtId,
          bbox: polygonBbox(input.geoPoly),
          filters: resolved.filters,
          idOverrides: resolved.idOverrides,
          contactsMadeIdOverrides: resolved.contactsMadeIdOverrides,
          excludePersonIds,
        })
        const stops = this.buildStops(people, input.geoPoly, isServe)

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
            // The talking points, frozen with the walk on the same column
            // every other channel already stores its script in. Frozen for
            // the same reason the route is: a canvasser who started the list
            // and a canvasser who picks it up next week read the same card.
            script: input.talkingPoints,
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
    // No role to check here: creating a turf is manager+ only, and the
    // creator reading back their own just-created turf needs no assignment
    // gate — an undefined role is the guard's own "unrestricted" no-op.
    return this.turfs.get(turfId, organization.slug, actorUserId, undefined)
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
    isServe: boolean,
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
      throw new BadRequestException(emptyTurfMessage(isServe))
    }

    const byCoordinate = new Map<string, PlannedStop>()
    for (const person of inside) {
      // Snapped to ~1m rather than compared exactly: two voter rows for one
      // building whose coordinates differ in the last decimal used to become
      // two stops, which the route planner was then free to put a trip across
      // the street between. The stop still keeps the first resident's real
      // coordinate — this is a grouping key, not a position.
      const key = coordinateKey(person.lat, person.lng)
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

  // The vendor orders BLOCK FACES; this orders the doors inside them.
  //
  // Sending it the doors themselves is what produced the reported zigzag: with
  // nothing but coordinates to go on it minimizes travel time, and crossing a
  // residential street costs about a minute either way, so two even-side
  // neighbours with an odd-side door between them is a perfectly good answer
  // to the question we were asking. Grouping first asks a better one — which
  // block face next — and leaves the part that is genuinely a routing problem
  // where the road network is. See utils/blockFace.util.ts.
  private async planStops(
    stops: PlannedStop[],
    request: RouteRequest,
  ): Promise<RoutePlannerPlan> {
    const faces = groupIntoBlockFaces(stops)

    // One face is not a routing problem, and asking anyway is a request the
    // vendor cannot answer. Every anchor below is placed ON a face
    // representative, so with a single face the lone job and both anchors are
    // the same point: the request collapses to one unique coordinate, and
    // Geoapify answers it with no plan at all and
    // `issues: {unassigned_agents: [0], unassigned_jobs: [0]}` — which
    // planRoute raises as a 502. Reproduced against the live API on known-good
    // walkable coordinates, where the identical one-job request plans fine as
    // soon as an anchor moves off the job, so what it refuses is the collapse
    // and not the geography.
    //
    // Not asking loses nothing. The vendor's only contribution is the face
    // ORDER, which is `[0]` when there is one face, and its legs and totals
    // are discarded and re-derived below in either case. `locations: 0` is
    // what keeps the ledger honest: no call was made, so nothing was billed.
    let plan: RoutePlannerPlan
    try {
      plan =
        faces.length < 2
          ? SINGLE_FACE_PLAN
          : await this.orderFaces(faces, stops, request)
    } catch (error) {
      // A refusal is about these coordinates and will be the same refusal
      // tomorrow, so it becomes a 400 naming the addresses rather than a 502
      // asking the candidate to wait. Anything else — a timeout, a vendor 5xx,
      // a response we could not read — keeps the status planRoute gave it.
      if (error instanceof RoutePlanRejectedError) {
        throw this.unroutableTurfError(error, faces, stops, request)
      }
      throw error
    }

    const sequenced = sequenceBlockFaces({
      stops,
      faces,
      faceOrder: plan.orderedJobIds.map(Number),
      faceLegSeconds: plan.legSeconds,
      faceLegMeters: plan.legMeters,
      mode: request.mode,
      loop: request.loop,
    })

    // Totals are re-derived rather than passed through: the vendor's are for
    // its own tour of representatives, and the per-leg numbers on the walk
    // sheet should add up to the total printed above them.
    return {
      ...plan,
      orderedJobIds: sequenced.stopIndexes.map(String),
      legSeconds: sequenced.legSeconds,
      legMeters: sequenced.legMeters,
      totalSeconds: sequenced.totalSeconds,
      totalMeters: sequenced.totalMeters,
      pathGeometry: null,
    }
  }

  // Turns the vendor's opaque job ids back into addresses a candidate can find
  // on the map and redraw around.
  //
  // A job is a block FACE, and the vendor only ever saw that face's
  // representative — so the refusal is about that one coordinate, not about
  // every door on the street. Naming the representative is therefore the
  // honest answer, and naming all of the face's doors would invent a problem
  // for addresses nothing was ever asked about.
  private unroutableTurfError(
    error: RoutePlanRejectedError,
    faces: BlockFace[],
    stops: PlannedStop[],
    request: RouteRequest,
  ): BadRequestException {
    const addresses = error.unroutableJobIds
      .map((jobId) => faces[Number(jobId)])
      .filter((face): face is BlockFace => face !== undefined)
      .map((face) => stops[representativeOf(face, stops)]!.displayAddress)

    // Kept as a log line as well as a message: 400s are excluded from the
    // route alerts by design (docs/observability.md § Server-errors-only
    // controllers), so without this the only record that the vendor could not
    // reach one of our geocodes would be the one the candidate reads and
    // closes.
    this.logger.warn(
      {
        unroutableJobIds: error.unroutableJobIds,
        addresses,
        mode: request.mode,
      },
      'door-knocking turf contains stops the route planner cannot reach',
    )

    const travel = request.mode === 'walk' ? 'on foot' : 'by road'
    if (!addresses.length) {
      return new BadRequestException(
        `We couldn't build a route for this turf. Some of these addresses may ` +
          `not be reachable ${travel} — try drawing a slightly different area.`,
      )
    }

    const named = addresses.slice(0, MAX_NAMED_UNROUTABLE).join(', ')
    const rest = addresses.length - MAX_NAMED_UNROUTABLE
    const list = rest > 0 ? `${named} and ${rest} more` : named
    const them = addresses.length > 1 ? 'them' : 'it'
    return new BadRequestException(
      `We couldn't find a way to reach ${list} ${travel}. Redraw the turf to ` +
        `leave ${them} out, then build the route again.`,
    )
  }

  // The billed call: which face to walk next, asked of the road network.
  private async orderFaces(
    faces: BlockFace[],
    stops: PlannedStop[],
    request: RouteRequest,
  ): Promise<RoutePlannerPlan> {
    const representatives = faces.map((face) => representativeOf(face, stops))
    const jobs = representatives.map((stopIndex, faceIndex) => ({
      id: String(faceIndex),
      location: [stops[stopIndex]!.lng, stops[stopIndex]!.lat] as LngLat,
    }))

    // Anchors are deterministic, never random, and are placed on face
    // representatives for the same reasons they were placed on stops. Loop:
    // start = end at the first by address (a closed tour is the same cycle
    // from anywhere, so the anchor is cost-free). Open: end-only anchor,
    // letting the vendor pick the best start.
    //
    // The open anchor sits on the face NEAREST the centroid, and the one thing
    // it must not be is the farthest — which is what it used to be, chosen so
    // the walk ended at the turf's far edge. The farthest face from the centre
    // is also exactly where a bad geocode lands, and an anchor the road network
    // cannot reach is the worst input this API takes: measured against the live
    // Route Planner, an unreachable anchor makes it sit on the request until its
    // own gateway gives up at 120s (3 of 3 attempts, HTTP 504), which our 30s
    // deadline turns into a timeout nobody can act on. Worse, when it does
    // answer it marks EVERY job unassigned, so the one broken address is
    // indistinguishable from a turf that cannot be walked at all.
    //
    // Anchoring at the centre costs almost nothing and buys the diagnosis. On
    // an 8-face Lincoln Park turf: 2366s/2658m from the far edge against
    // 2403s/2698m from the centre, 1.6% slower. With one unroutable stop added,
    // the far-edge anchor returns no plan and all 9 jobs unassigned, while the
    // central anchor returns the other 8 planned and `unassigned_jobs: [8]` —
    // the single address to name, which is what makes the 400 below possible.
    const anchorStops = representatives.map((stopIndex) => stops[stopIndex]!)
    let agent: { start_location?: LngLat; end_location?: LngLat }
    if (request.loop) {
      const anchorIndex = anchorStops.reduce(
        (best, stop, index) =>
          stop.displayAddress.localeCompare(anchorStops[best]!.displayAddress) <
          0
            ? index
            : best,
        0,
      )
      const anchor = jobs[anchorIndex]!.location
      agent = { start_location: anchor, end_location: anchor }
    } else {
      const centroidLat =
        anchorStops.reduce((sum, stop) => sum + stop.lat, 0) /
        anchorStops.length
      const centroidLng =
        anchorStops.reduce((sum, stop) => sum + stop.lng, 0) /
        anchorStops.length
      const anchorIndex = anchorStops.reduce((best, stop, index) => {
        const d = (s: PlannedStop) =>
          (s.lat - centroidLat) ** 2 + (s.lng - centroidLng) ** 2
        return d(stop) < d(anchorStops[best]!) ? index : best
      }, 0)
      agent = { end_location: jobs[anchorIndex]!.location }
    }

    // Checked here rather than on the stop list, because these are the
    // coordinates the request actually carries, and before the call rather
    // than after it, because the vendor's answer to this is a 400 we would
    // have to pay for and then mistranslate.
    if (request.mode === 'walk') {
      const spread = maxPairwiseMeters(anchorStops)
      if (spread > WALK_SPREAD_LIMIT_METERS) {
        throw new BadRequestException(
          `This turf spans about ${Math.round(spread / 1000)} km, which is too ` +
            `far apart to plan as a walk. Draw a smaller area, or switch to ` +
            `driving.`,
        )
      }
    }

    return this.geoapify.planRoute({
      mode: request.mode,
      agent,
      jobs,
      // The plan's polyline would thread the face representatives, not the
      // doors, so it is not worth a second billed call. Consumers fall back to
      // straight legs between consecutive stops — and under a serpentine order
      // those consecutive stops are next-door neighbours, so the straight line
      // IS the sidewalk.
      fetchGeometry: false,
    })
  }
}
