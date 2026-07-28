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
import { convertVoterFileFilterToFilters } from '@/contacts/utils/voterFileFilter.utils'
import { ContactsService } from '@/contacts/services/contacts.service'
import { GeoapifyRoutePlannerService } from '@/vendors/geoapify/services/geoapifyRoutePlanner.service'
import type { LngLat } from '@/vendors/geoapify/services/geoapifyRoutePlanner.service'
import {
  Campaign,
  DoorKnockingRoute,
  Organization,
  OutreachStatus,
  OutreachType,
} from '../../generated/prisma'
import { DoorKnockingPeopleApiService } from './doorKnockingPeopleApi.service'
import { pointInPolygon, polygonBbox } from '../utils/geo.util'
import { lockTurf } from '../utils/turfLock.util'

// Leadership-approved hard cap; the DB CHECK on stop.seq enforces the same
// bound.
const MAX_STOPS = 150
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

    return this.client.$transaction(
      async (tx) => {
        await lockTurf(tx, turfId)

        // The turf (and its polygon) is read AFTER the lock, so a racing
        // edit can't slip a changed polygon between read and freeze — turf
        // update/delete take the same lock.
        const turf = await tx.doorKnockingTurf.findFirst({
          where: {
            id: turfId,
            voterFileFilter: { organizationSlug: organization.slug },
          },
          include: { voterFileFilter: true },
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

        const { people } = await this.peopleApi.evaluate({
          districtId,
          bbox: polygonBbox(turf.geoPoly),
          filters: convertVoterFileFilterToFilters(filter),
        })
        const stops = this.buildStops(people, turf.geoPoly)

        const plan = await this.planStops(stops, request)

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
