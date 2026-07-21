import { Injectable, NotFoundException } from '@nestjs/common'
import {
  DoorKnockingResidentsResponse,
  DoorKnockingRoutePayload,
  DoorKnockingRoutePayloadSchema,
  DoorKnockStatus,
  RoutePayloadAddress,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  DoorKnockingStopTarget,
  Organization,
  Prisma,
} from '../../generated/prisma'
import { DoorKnockingPeopleApiService } from './doorKnockingPeopleApi.service'
import { deriveKnockStatus, rollupStopStatus } from '../utils/knockStatus.util'

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

// The frozen unit key renders back to a human address line: street parts
// joined in display order, apartment suffixed. Old line-format keys (a
// single AddressLine first segment) degrade gracefully to that segment.
const renderUnitAddress = (addressKey: string): string => {
  const parts = addressKey.split('|')
  if (parts.length < 7) return parts[0] ?? addressKey
  const [house, prefixDir, street, designator, suffixDir, apartment] = parts
  const line = [house, prefixDir, street, designator, suffixDir]
    .filter((part) => part && part.length > 0)
    .join(' ')
  return apartment && apartment.length > 0 ? `${line} Apt ${apartment}` : line
}

@Injectable()
export class DoorKnockingServeService extends createPrismaBase(
  MODELS.DoorKnockingRoute,
) {
  constructor(
    private readonly peopleApi: DoorKnockingPeopleApiService,
    private readonly contacts: ContactsService,
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
      where: {
        id: turfId,
        voterFileFilter: { organizationSlug: organization.slug },
      },
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

    const statusByPersonId = await this.latestKnockStatuses(
      organization.slug,
      targetPersonIds,
    )

    return DoorKnockingRoutePayloadSchema.parse({
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
        )
        return {
          id: stop.id,
          seq: stop.seq,
          lat: stop.lat,
          lng: stop.lng,
          displayAddress: stop.displayAddress,
          legSeconds: stop.legSeconds,
          legMeters: stop.legMeters,
          knockStatus: rollupStopStatus(
            addresses.flatMap((address) =>
              address.targets.map((target) => target.knockStatus),
            ),
          ),
          addresses,
        }
      }),
    })
  }

  private buildAddresses(
    targets: DoorKnockingStopTarget[],
    stopDisplayAddress: string,
    liveByAddressKey: Map<string, LiveAddress>,
    statusByPersonId: Map<string, DoorKnockStatus>,
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
            knockStatus: statusByPersonId.get(target.personId) ?? 'unknown',
            mayHaveMoved: !livePerson,
          }
        }),
        otherResidents: (live?.otherResidents ?? []).map((person) => ({
          name: composeName(person),
        })),
      }
    })
  }

  // Latest interaction per person, org-wide — served by the CRM table's
  // (organizationSlug, personId, occurredAt) index; rows per person are
  // bounded by real knock history, so the reduce stays cheap.
  private async latestKnockStatuses(
    organizationSlug: string,
    personIds: string[],
  ): Promise<Map<string, DoorKnockStatus>> {
    const interactions = await this.client.contactInteractionDoorKnock.findMany(
      {
        where: { organizationSlug, personId: { in: personIds } },
        orderBy: [
          { occurredAt: Prisma.SortOrder.desc },
          { id: Prisma.SortOrder.desc },
        ],
        select: { personId: true, outcome: true, supportAnswer: true },
      },
    )

    const statusByPersonId = new Map<string, DoorKnockStatus>()
    for (const interaction of interactions) {
      if (!statusByPersonId.has(interaction.personId)) {
        statusByPersonId.set(
          interaction.personId,
          deriveKnockStatus(interaction),
        )
      }
    }
    return statusByPersonId
  }
}
