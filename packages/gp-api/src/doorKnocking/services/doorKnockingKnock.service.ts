import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  DoorKnockingKnockRequest,
  DoorKnockingKnockResponse,
  DoorKnockingRouteHeader,
  GeoJsonPolygon,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { GeoapifyRoutePlannerService } from '@/vendors/geoapify/services/geoapifyRoutePlanner.service'
import type { LngLat } from '@/vendors/geoapify/services/geoapifyRoutePlanner.service'
import { recordRoutePlannerCredits } from '@/vendors/geoapify/observability/geoapify.metrics'
import {
  Campaign,
  ContactStatusField,
  DoNotKnockStatus,
  DoorKnockingRoute,
  NotAVoterStatus,
  Organization,
  OutreachStatus,
  OutreachType,
} from '../../generated/prisma'
import { DoorKnockingPeopleApiService } from './doorKnockingPeopleApi.service'
import { pointInPolygon, polygonBbox } from '../utils/geo.util'
import { lockTurf } from '../utils/turfLock.util'
import { activeTurfScope } from '../utils/turfScope.util'
import {
  assertWaypointQuota,
  recordWaypointSpend,
} from '../utils/waypointQuota.util'

// Leadership-approved hard cap; the DB CHECK on stop.seq enforces the same
// bound. Exported so the draw-step preview materializes addresses only up to
// the number of stops a savable list can hold, rather than carrying a second
// 150 that can drift from this one.
export const MAX_STOPS = 150
// Geoapify bills the Route Planner at 10 credits per location (the
// schema-documented meaning of route.credits).
const GEOAPIFY_CREDITS_PER_LOCATION = 10
// The vendor call happens inside the lock-holding transaction by design (so
// concurrent knocks make exactly one call); the timeout must absorb it.
const KNOCK_TX_TIMEOUT_MS = 120_000

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

const toHeader = (
  route: DoorKnockingRoute,
  stopCount: number,
): DoorKnockingRouteHeader => ({
  id: route.id,
  doorKnockingTurfId: route.doorKnockingTurfId,
  mode: route.mode,
  loop: route.loop,
  totalSeconds: route.totalSeconds,
  totalMeters: route.totalMeters,
  stopCount,
  createdAt: route.createdAt,
})

@Injectable()
export class DoorKnockingKnockService extends createPrismaBase(
  MODELS.DoorKnockingRoute,
) {
  constructor(
    private readonly peopleApi: DoorKnockingPeopleApiService,
    private readonly geoapify: GeoapifyRoutePlannerService,
    private readonly contacts: ContactsService,
    private readonly contactStatus: ContactStatusService,
  ) {
    super()
  }

  async knock(
    turfId: number,
    organization: Organization,
    campaign: Campaign | null,
    request: DoorKnockingKnockRequest,
  ): Promise<DoorKnockingKnockResponse> {
    // Runs the same eligibility gate as every other voter-data read — a
    // Win campaign without downloadable voter data can't knock either.
    const districtId =
      await this.contacts.resolveEligibleDistrictId(organization)

    // ADR 0007 and ADR 0008. Read outside the transaction, like the district
    // resolution above: they touch a different table and adding them to the
    // critical section would hold the turf lock across two more round trips.
    // Both sets are the org's own flagged people, small by construction.
    //
    // One exclusion list, because evaluation has one job either way: leave
    // this person's door out of the next route. Deduped because a person told
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

    return this.client.$transaction(
      async (tx) => {
        await lockTurf(tx, turfId)

        // The turf (and its polygon) is read AFTER the lock, so a racing
        // edit can't slip a changed polygon between read and freeze — turf
        // update/delete take the same lock.
        const turf = await tx.doorKnockingTurf.findFirst({
          where: { id: turfId, ...activeTurfScope(organization.slug) },
          // activityConditions is a relation, so it has to be pulled in
          // explicitly — without it the resolution below sees a list with no
          // conditions and knocks the unfiltered roster.
          include: {
            voterFileFilter: { include: { activityConditions: true } },
          },
        })
        if (!turf) {
          throw new NotFoundException('Turf not found')
        }
        const filter = turf.voterFileFilter

        const existing = await tx.doorKnockingRoute.findUnique({
          where: { doorKnockingTurfId: turfId },
          include: { _count: { select: { stops: true } } },
        })
        if (existing) {
          return {
            created: false,
            route: toHeader(existing, existing._count.stops),
          }
        }

        // The turf's own saved list, resolved exactly as the CRM resolves it.
        // Anything less and the list's activity conditions, support-status,
        // contacts-made, and voter-likelihood overrides stop applying the
        // moment it's knocked — the roster the candidate previewed in
        // Contacts and the roster they walk would quietly disagree.
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
          bbox: polygonBbox(turf.geoPoly),
          filters: resolved.filters,
          idOverrides: resolved.idOverrides,
          contactsMadeIdOverrides: resolved.contactsMadeIdOverrides,
          excludePersonIds,
        })
        const stops = this.buildStops(people, turf.geoPoly)

        // Last gate before the only paid call in the system. The re-knock
        // probe above returns without spending anything, so a route is never
        // billed to the budget twice.
        //
        // The advisory lock serializes per turf, not per organization, so two
        // turfs knocked in the same instant can both read the same spend and
        // overshoot. That's bounded by the 150-stop cap and preferable to
        // holding an org-wide lock across a 30-second vendor call — this is a
        // spend guardrail, not a billing boundary.
        await assertWaypointQuota(tx, organization.slug, stops.length)

        const plan = await this.planStops(stops, request)

        // The vendor has been paid. Record it before anything below can fail,
        // and on `this.client` rather than `tx` so the ledger row survives a
        // rollback of the freeze — otherwise the budget forgets a call that
        // really happened and hands the same allowance out again.
        await this.recordSpend(organization.slug, turfId, stops.length)

        const route = await tx.doorKnockingRoute.create({
          data: {
            doorKnockingTurfId: turfId,
            mode: request.mode,
            loop: request.loop,
            totalSeconds: plan.totalSeconds,
            totalMeters: plan.totalMeters,
            credits: stops.length * GEOAPIFY_CREDITS_PER_LOCATION,
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

        // First knock against this filter locks it from edits, same as any
        // other outreach launch (first-write-wins, never rolled back).
        await tx.voterFileFilter.updateMany({
          where: { id: filter.id, firstUsedForOutreachAt: null },
          data: { firstUsedForOutreachAt: new Date() },
        })

        // The envelope makes the route show up on outreach surfaces. Orgs
        // without a campaign (Serve) still get a route — just no envelope.
        if (campaign) {
          await tx.outreach.create({
            data: {
              campaignId: campaign.id,
              organizationSlug: campaign.organizationSlug,
              outreachType: OutreachType.nativeDoorKnocking,
              status: OutreachStatus.in_progress,
              name: turf.name,
              voterFileFilterId: filter.id,
              doorKnockingRouteId: route.id,
              date: new Date(),
            },
          })
        }

        return { created: true, route: toHeader(route, stops.length) }
      },
      { timeout: KNOCK_TX_TIMEOUT_MS },
    )
  }

  // A failed ledger write must not fail a knock the vendor already billed, so
  // this logs and continues. The consequence of losing a row is an under-count
  // of the daily budget — the same failure mode the old stop-row read had for
  // every rolled-back knock, and far cheaper than rejecting paid work.
  private async recordSpend(
    organizationSlug: string,
    turfId: number,
    stops: number,
  ): Promise<void> {
    const credits = stops * GEOAPIFY_CREDITS_PER_LOCATION

    // Emitted before the ledger write and independently of its outcome: the
    // vendor has already billed, so this line — not the ledger — is what the
    // spend queries and the global daily-credit ceiling alert count. Losing a
    // ledger row is allowed to under-count one org's quota; it must not also
    // hide the money. Carries organizationSlug so per-org-per-day spend (and
    // any ENG-10901 overshoot past the 500-waypoint cap) is queryable in Loki
    // without the cardinality cost of a Prometheus label.
    this.logger.info({
      event: 'DoorKnockingSpend',
      organizationSlug,
      turfId,
      waypoints: stops,
      credits,
    })
    recordRoutePlannerCredits(credits)

    try {
      await recordWaypointSpend(this.client, {
        organizationSlug,
        doorKnockingTurfId: turfId,
        waypoints: stops,
        credits,
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

  private async planStops(
    stops: PlannedStop[],
    request: DoorKnockingKnockRequest,
  ) {
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
