import { Injectable } from '@nestjs/common'
import {
  DoorKnockingAddressPreviewResponse,
  DoorKnockingPreviewLocation,
  GeoJsonPolygon,
} from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import {
  ContactStatusField,
  DoNotKnockStatus,
  NotAVoterStatus,
  Organization,
} from '../../generated/prisma'
import { DoorKnockingPeopleApiService } from './doorKnockingPeopleApi.service'
import { MAX_STOPS } from './doorKnockingKnock.service'
import { pointInPolygon, polygonBbox } from '../utils/geo.util'
import { renderUnitAddress } from '../utils/unitAddress.util'
import { DoorKnockingAddressPreview } from '../schemas/doorKnockingAddressPreview.schema'

type EvaluatedPerson = {
  id: string
  lat: number
  lng: number
  addressKey: string
}

const EMPTY_PREVIEW: DoorKnockingAddressPreviewResponse = {
  stops: 0,
  doors: 0,
  people: 0,
  locations: [],
}

// The draw step's answer to "which houses are these?", asked before anything
// is bought. It runs the knock's own evaluation — the same resolved filters,
// the same suppression, the same polygon test — and stops short of the vendor
// call, so the addresses on screen are the addresses the route would freeze.
//
// Nothing here is persisted and no Geoapify credit is spent; the only cost is
// one people-db scan per explicit request. See ADR 0010 for why that request
// is explicit rather than debounced.
@Injectable()
export class DoorKnockingPreviewService {
  constructor(
    private readonly peopleApi: DoorKnockingPeopleApiService,
    private readonly contacts: ContactsService,
    private readonly contactStatus: ContactStatusService,
  ) {}

  async preview(
    organization: Organization,
    input: DoorKnockingAddressPreview,
  ): Promise<DoorKnockingAddressPreviewResponse> {
    const districtId =
      await this.contacts.resolveEligibleDistrictId(organization)

    // ADR 0007 and ADR 0008, deduped into one exclusion list exactly as the
    // knock builds it. A door whose every resident is flagged therefore has
    // nobody left to evaluate and does not appear at all — which is not the
    // preview hiding it but the route not containing it, since a knock of
    // this shape would drop the same people.
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

    // The same three-step resolution the knock runs, on a filter draft that
    // has not been saved yet. `convertVoterFileFilterToFilters` alone drops
    // activity conditions, support status, contacts-made and the
    // voter-likelihood overrides, so anything less would preview an audience
    // the list would not knock — the exact drift this endpoint exists to
    // close. It also carries the Win-only party and contacts-made gates, so
    // an elected-office org gets the same 400 here as at knock time.
    const resolved = await this.contacts.resolveSavedFilterForQuery(
      organization,
      input.filters,
    )
    // Nobody survives the draft's own filters. The knock raises a 400 here
    // because a turf is being committed; a shape still being drawn is
    // allowed to enclose nobody, and the draw step already says "No doors in
    // this area" for it. Erroring would turn ordinary drawing into a failure.
    if (resolved.empty) return EMPTY_PREVIEW

    const { people } = await this.peopleApi.evaluate({
      districtId,
      bbox: polygonBbox(input.geoPoly),
      filters: resolved.filters,
      idOverrides: resolved.idOverrides,
      contactsMadeIdOverrides: resolved.contactsMadeIdOverrides,
      excludePersonIds,
    })

    return this.summarize(people, input.geoPoly)
  }

  // Mirrors DoorKnockingKnockService.buildStops: the bbox is a prefilter, so
  // the ray-cast is what decides membership; ordering is deterministic on
  // (addressKey, id); a stop is a unique coordinate and a door is a unique
  // unit key within it. Written out rather than shared with the knock, which
  // additionally throws on an empty or oversized turf — behaviour a shape
  // being drawn must not have.
  private summarize(
    people: EvaluatedPerson[],
    polygon: GeoJsonPolygon,
  ): DoorKnockingAddressPreviewResponse {
    const inside = people
      .filter((person) => pointInPolygon(person.lng, person.lat, polygon))
      .sort(
        (a, b) =>
          a.addressKey.localeCompare(b.addressKey) || a.id.localeCompare(b.id),
      )
    if (inside.length === 0) return EMPTY_PREVIEW

    const byCoordinate = new Map<string, Map<string, number>>()
    for (const person of inside) {
      const key = `${person.lat}|${person.lng}`
      let doors = byCoordinate.get(key)
      if (!doors) {
        doors = new Map<string, number>()
        byCoordinate.set(key, doors)
      }
      doors.set(person.addressKey, (doors.get(person.addressKey) ?? 0) + 1)
    }

    const stops = byCoordinate.size
    let doors = 0
    const locations: DoorKnockingPreviewLocation[] = []
    for (const doorsAtStop of byCoordinate.values()) {
      doors += doorsAtStop.size
      // Whole locations only: a half-listed building would report fewer
      // doors than it has, which is the one thing a door list must not do.
      if (locations.length >= MAX_STOPS) continue
      locations.push({
        doors: [...doorsAtStop.entries()].map(([addressKey, count]) => ({
          address: renderUnitAddress(addressKey),
          people: count,
        })),
      })
    }

    return { stops, doors, people: inside.length, locations }
  }
}
