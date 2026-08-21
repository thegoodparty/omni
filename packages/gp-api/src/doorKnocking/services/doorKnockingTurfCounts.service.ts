import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { DoorKnockingStatusService } from './doorKnockingStatus.service'

export type DoorKnockingTurfCounts = {
  doorCount: number
  peopleCount: number
  loggedCount: number
}

// Two targets are the same DOOR when they share a stop and an address key.
// `addressKey` contains pipes of its own, so the stop id goes first: it is
// numeric, so the first pipe always ends it and the pair round-trips.
//
// Not a bare `COUNT(DISTINCT address_key)` over the route, and the difference
// is not academic — `buildStops` groups by COORDINATE, so one address key
// geocoded to two points is two stops and therefore two doors. The walk's own
// `countDoors` sums addresses WITHIN each stop, so pairing the key with its
// stop is what makes these the same number rather than nearly the same one.
const doorKey = (stopId: number, addressKey: string) =>
  `${stopId}|${addressKey}`

// One aggregate for the whole rail. The only route that can answer these
// today is `serve`, which is a nested route fetch plus a people-api round trip
// plus four CRM queries — running it once per list on the first screen a
// candidate lands on is what makes it expensive, so this is deliberately not a
// per-list fan-out. Six queries no matter how many lists the org has — one for
// the targets, one Prisma issues for their stops, three current-status reads
// and one interaction read — and the person-keyed reads are deduplicated
// across lists, so a resident in three of them is looked up once. Measured on
// the dev database: 27ms median for the whole endpoint at a dozen 150-stop
// lists (2,760 targets, 2,128 people), against an 8ms floor for the same rail
// with nothing locked.
//
// None of the three numbers is a Prisma `_count`. Doors are addresses rather
// than stop rows; people exclude the two suppression flags; "logged" is
// derived from interaction history. The latter two live in tables reached
// through (organizationSlug, personId) with no relation to join on.
@Injectable()
export class DoorKnockingTurfCountsService extends createPrismaBase(
  MODELS.DoorKnockingStopTarget,
) {
  constructor(private readonly status: DoorKnockingStatusService) {
    super()
  }

  // Keyed by route id, which is the turf's lock: an unlocked turf has no route
  // and so is absent from the result rather than present with zeroes.
  async forRoutes(
    organizationSlug: string,
    routeIds: number[],
  ): Promise<Map<number, DoorKnockingTurfCounts>> {
    if (routeIds.length === 0) return new Map()

    const targets = await this.model.findMany({
      where: { stop: { doorKnockingRouteId: { in: routeIds } } },
      select: {
        personId: true,
        addressKey: true,
        doorKnockingStopId: true,
        stop: { select: { doorKnockingRouteId: true } },
      },
    })

    const personIds = [...new Set(targets.map((target) => target.personId))]
    const [statusByPersonId, doNotKnockPersonIds, notAVoterReasons] =
      await Promise.all([
        this.status.latestKnockStatuses(organizationSlug, personIds),
        this.status.doNotKnockPersonIds(organizationSlug, personIds),
        this.status.notAVoterReasons(organizationSlug, personIds),
      ])

    const doors = new Map<number, Set<string>>()
    const people = new Map<number, number>()
    const logged = new Map<number, number>()
    for (const routeId of routeIds) {
      doors.set(routeId, new Set())
      people.set(routeId, 0)
      logged.set(routeId, 0)
    }

    for (const target of targets) {
      const routeId = target.stop.doorKnockingRouteId
      doors
        .get(routeId)
        ?.add(doorKey(target.doorKnockingStopId, target.addressKey))

      // The walk's `isKnockable`: ADR 0007 do-not-knock and ADR 0008
      // not-a-voter residents are nobody to talk to, so they are not people
      // this list can log — counting them would hold a canvasser who
      // correctly skipped every flagged house below 100%.
      if (
        doNotKnockPersonIds.has(target.personId) ||
        notAVoterReasons.has(target.personId)
      ) {
        continue
      }
      people.set(routeId, (people.get(routeId) ?? 0) + 1)

      // "Logged", not "reached": not_home, inaccessible and refused all
      // satisfy this, and none of them is a conversation. Counted over the
      // same knockable people as above, never over doors — the pair is
      // rendered as one ratio, so both halves have to be one population.
      if ((statusByPersonId.get(target.personId) ?? 'unknown') !== 'unknown') {
        logged.set(routeId, (logged.get(routeId) ?? 0) + 1)
      }
    }

    return new Map(
      routeIds.map((routeId) => [
        routeId,
        {
          doorCount: doors.get(routeId)?.size ?? 0,
          peopleCount: people.get(routeId) ?? 0,
          loggedCount: logged.get(routeId) ?? 0,
        },
      ]),
    )
  }
}
