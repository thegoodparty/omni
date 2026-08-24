import { Injectable, NotFoundException } from '@nestjs/common'
import {
  DoorKnockingDemographicsShape,
  DoorKnockingResidentsResponse,
  DoorKnockingRoutePayload,
  DoorKnockStatus,
  NotAVoterReason,
  RoutePayloadAddress,
  RoutePayloadTarget,
  RoutePayloadTargetNotes,
  RouteTargetActivity,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  DoorKnockingStopTarget,
  Organization,
  Prisma,
} from '../../generated/prisma'
import { DoorKnockingActivityService } from './doorKnockingActivity.service'
import { DoorKnockingNotesService } from './doorKnockingNotes.service'
import { DoorKnockingPeopleApiService } from './doorKnockingPeopleApi.service'
import { DoorKnockingStatusService } from './doorKnockingStatus.service'
import { renderUnitAddress } from '../utils/unitAddress.util'
import { activeTurfScope } from '../utils/turfScope.util'

const ROUTE_INCLUDE = {
  stops: {
    orderBy: { seq: Prisma.SortOrder.asc },
    include: { targets: true },
  },
} as const satisfies Prisma.DoorKnockingRouteInclude

type LiveAddress = DoorKnockingResidentsResponse['addresses'][number]

const composeName = (
  person: { firstName: string | null; lastName: string | null } | undefined,
): string | null =>
  person
    ? [person.firstName, person.lastName].filter(Boolean).join(' ') || null
    : null

type LiveTarget = LiveAddress['targets'][number]

// The eleven attributes people-api resolved for a live target, copied onto the
// route payload one for one. Every one is null for a target with no live row
// (`mayHaveMoved`), like age, party and the phone numbers beside them.
//
// Hand-written rather than a spread of `livePerson` so the two contracts stay
// two decisions: the residents response is an internal S2S shape and the route
// payload is what reaches a canvasser's phone, and a field added to the former
// should not arrive on the latter without anyone choosing it. The explicit
// `Pick` is what makes forgetting one a type error instead of a hole.
const demographicsOf = (
  livePerson: LiveTarget | undefined,
): Pick<RoutePayloadTarget, keyof typeof DoorKnockingDemographicsShape> => ({
  registeredVoter: livePerson?.registeredVoter ?? null,
  turnoutLikelihood: livePerson?.turnoutLikelihood ?? null,
  maritalStatus: livePerson?.maritalStatus ?? null,
  hasChildrenUnder18: livePerson?.hasChildrenUnder18 ?? null,
  veteranStatus: livePerson?.veteranStatus ?? null,
  homeowner: livePerson?.homeowner ?? null,
  businessOwner: livePerson?.businessOwner ?? null,
  levelOfEducation: livePerson?.levelOfEducation ?? null,
  estimatedIncomeAmount: livePerson?.estimatedIncomeAmount ?? null,
  language: livePerson?.language ?? null,
  ethnicityGroup: livePerson?.ethnicityGroup ?? null,
})

@Injectable()
export class DoorKnockingServeService extends createPrismaBase(
  MODELS.DoorKnockingRoute,
) {
  constructor(
    private readonly peopleApi: DoorKnockingPeopleApiService,
    private readonly contacts: ContactsService,
    // The same derivation the rail's per-list counts read. Shared rather than
    // duplicated: the sheet quoting this payload and the row above it must
    // report one list identically.
    private readonly status: DoorKnockingStatusService,
    private readonly activity: DoorKnockingActivityService,
    private readonly notes: DoorKnockingNotesService,
  ) {
    super()
  }

  // Every read of a route = the frozen artifact + live enrichment: current
  // residents from people-api and org-wide knock statuses from the CRM's
  // door-knock interactions (prior-route and prior-campaign contact is
  // deliberately visible at the door).
  async serve(
    turfId: number,
    organization: Organization,
  ): Promise<DoorKnockingRoutePayload> {
    const turf = await this.client.doorKnockingTurf.findFirst({
      where: { id: turfId, ...activeTurfScope(organization.slug) },
      include: { route: { include: ROUTE_INCLUDE } },
    })
    if (!turf) {
      throw new NotFoundException('Turf not found')
    }
    if (!turf.route) {
      throw new NotFoundException('This turf has not been knocked yet')
    }
    const route = turf.route

    const targets = route.stops.flatMap((stop) => stop.targets)
    const addressKeys = [...new Set(targets.map((t) => t.addressKey))]
    const targetPersonIds = [...new Set(targets.map((t) => t.personId))]

    // knock() can't freeze a targetless route, but guard anyway: people-api
    // rejects empty key arrays, which would surface here as a 502.
    const residents =
      targets.length > 0
        ? await this.peopleApi.residents({
            districtId:
              await this.contacts.resolveEligibleDistrictId(organization),
            addressKeys,
            targetPersonIds,
          })
        : { addresses: [] }
    const liveByAddressKey = new Map<string, LiveAddress>(
      residents.addresses.map((address) => [address.addressKey, address]),
    )

    const [
      statusByPersonId,
      doNotKnockPersonIds,
      notAVoterReasons,
      historyByPersonId,
      notesByPersonId,
    ] = await Promise.all([
      this.status.latestKnockStatuses(organization.slug, targetPersonIds),
      this.status.doNotKnockPersonIds(organization.slug, targetPersonIds),
      this.status.notAVoterReasons(organization.slug, targetPersonIds),
      this.activity.historyByPersonId(organization.slug, targetPersonIds),
      // Every target's notes in one query, alongside the other live reads
      // rather than per target inside the map below — see ADR 0011.
      this.notes.notesByPersonId(organization.slug, targetPersonIds),
    ])

    return {
      route: {
        id: route.id,
        doorKnockingTurfId: route.doorKnockingTurfId,
        mode: route.mode,
        loop: route.loop,
        totalSeconds: route.totalSeconds,
        totalMeters: route.totalMeters,
        stopCount: route.stops.length,
        createdAt: route.createdAt,
      },
      pathGeometry: route.pathGeometry ?? null,
      stops: route.stops.map((stop) => {
        const addresses = this.buildAddresses(
          stop.targets,
          stop.displayAddress,
          liveByAddressKey,
          statusByPersonId,
          doNotKnockPersonIds,
          notAVoterReasons,
          historyByPersonId,
          notesByPersonId,
        )
        return {
          id: stop.id,
          seq: stop.seq,
          lat: stop.lat,
          lng: stop.lng,
          displayAddress: stop.displayAddress,
          legSeconds: stop.legSeconds,
          legMeters: stop.legMeters,
          addresses,
        }
      }),
    }
  }

  private buildAddresses(
    targets: DoorKnockingStopTarget[],
    stopDisplayAddress: string,
    liveByAddressKey: Map<string, LiveAddress>,
    statusByPersonId: Map<string, DoorKnockStatus>,
    doNotKnockPersonIds: Set<string>,
    notAVoterReasons: Map<string, NotAVoterReason>,
    historyByPersonId: Map<string, RouteTargetActivity[]>,
    notesByPersonId: Map<string, RoutePayloadTargetNotes>,
  ): RoutePayloadAddress[] {
    const byAddressKey = new Map<string, DoorKnockingStopTarget[]>()
    for (const target of targets) {
      const group = byAddressKey.get(target.addressKey) ?? []
      group.push(target)
      byAddressKey.set(target.addressKey, group)
    }

    return [...byAddressKey.entries()].map(([addressKey, group]) => {
      const live = liveByAddressKey.get(addressKey)
      const liveTargetsById = new Map(
        (live?.targets ?? []).map((person) => [person.personId, person]),
      )
      return {
        addressKey,
        // Frozen at the lock: rendered from the key's own components —
        // never re-derived from live data, so the walk view matches what
        // was routed. The unit key is HOUSE|PREFIXDIR|STREET|DESIGNATOR|
        // SUFFIXDIR|APT|ZIP (DOOR_KNOCKING_UNIT_KEY_COLUMNS order).
        // An all-NULL-components key renders to '' — fall back to the
        // stop's frozen display line rather than serving a blank address.
        address: renderUnitAddress(addressKey) || stopDisplayAddress,
        targets: group.map((target) => {
          const livePerson = liveTargetsById.get(target.personId)
          return {
            stopTargetId: target.id,
            personId: target.personId,
            // Live name when the person is still there; the frozen snapshot
            // name renders for movers.
            name: composeName(livePerson) ?? target.name,
            age: livePerson?.age ?? null,
            politicalParty: livePerson?.politicalParty ?? null,
            // Live-only, so a mover carries no number: livePerson is what
            // mayHaveMoved is derived from.
            cellPhone: livePerson?.cellPhone ?? null,
            landline: livePerson?.landline ?? null,
            // The demographic profile, live-only for the same reason: a target
            // who no longer appears at the frozen addressKey carries nulls
            // rather than the profile of whoever lives there now. Spelled out
            // field by field rather than spread, so the payload can never pick
            // up a key the residents response grows later without someone
            // deciding it belongs at the door.
            ...demographicsOf(livePerson),
            knockStatus: statusByPersonId.get(target.personId) ?? 'unknown',
            // mayHaveMoved is the voter file disagreeing with the frozen
            // snapshot; notAVoterReason is a person at the door saying so.
            // They are independent on purpose — the file lags, and a mover's
            // live row is still where phone numbers come from.
            mayHaveMoved: !livePerson,
            doNotKnock: doNotKnockPersonIds.has(target.personId),
            notAVoterReason: notAVoterReasons.get(target.personId),
            // ADR 0009. Keyed by personId, so it is this resident's history
            // and not the household's — the two people behind one door often
            // answered differently, and merging them at the door attributes a
            // neighbor's refusal to whoever opens it.
            history: historyByPersonId.get(target.personId) ?? [],
            // ADR 0011. Per-resident like the feed above, and always present
            // even when empty: a resident nobody has written anything about is
            // a fact the sheet states, and it has to read differently from a
            // payload snapshotted before this field existed, where the key is
            // missing and nothing is being claimed at all.
            notes: notesByPersonId.get(target.personId) ?? {
              entries: [],
              total: 0,
            },
          }
        }),
        otherResidents: (live?.otherResidents ?? []).map((person) => ({
          name: composeName(person),
        })),
      }
    })
  }
}
