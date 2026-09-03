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
import { MAX_STOPS } from './doorKnockingCreate.service'
import { pointInPolygon, polygonBbox } from '../utils/geo.util'
import { renderDoorAddress, streetLineOfStop } from '../utils/unitAddress.util'

// One door of a stop: how many of the drawn shape's people live behind it, and
// the line to name it by.
type DoorTally = { people: number; displayAddress: string }
import { DoorKnockingAddressPreview } from '../schemas/doorKnockingAddressPreview.schema'

type EvaluatedPerson = {
  id: string
  lat: number
  lng: number
  addressKey: string
  // The line as a person would write it, which the uppercased key is not.
  // The create service freezes this same field onto the stop, so previewing
  // and then walking a list shows one house one way.
  displayAddress: string
}

const EMPTY_COUNTS = {
  stops: 0,
  doors: 0,
  people: 0,
  locations: [],
}

// The draw step's answer to "which houses are these?", asked before anything
// is bought. It runs the create transaction's own evaluation — the same
// resolved filters, the same suppression, the same polygon test — and stops
// short of the vendor call, so the addresses on screen are the addresses the
// route would freeze.
//
// Nothing here is persisted and no Geoapify credit is spent; the only cost is
// one people-db scan per explicit request. See ADR 0010 for why that request
// is explicit rather than debounced.
// Touches no table of its own. It used to extend the spend ledger's Prisma
// base to read the org's remaining daily stops off it; that allowance is gone,
// and with it the only reason this service held a client.
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
    // Nobody survives the draft's own filters. Creating a turf raises a 400
    // here because a list is being committed; a shape still being drawn is
    // allowed to enclose nobody, and the draw step already says "No doors in
    // this area" for it. Erroring would turn ordinary drawing into a failure.
    if (resolved.empty) {
      return EMPTY_COUNTS
    }

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

  // Mirrors DoorKnockingCreateService.buildStops: the bbox is a prefilter, so
  // the ray-cast is what decides membership; ordering is deterministic on
  // (addressKey, id); a stop is a unique coordinate and a door is a unique
  // unit key within it. Written out rather than shared with the create path,
  // which additionally throws on an empty or oversized turf — behaviour a
  // shape being drawn must not have.
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
    if (inside.length === 0) return EMPTY_COUNTS

    // Each door carries a display line as well as a count, because the count
    // alone cannot be rendered into an address a candidate recognises: the
    // addressKey is uppercased by the mirror, and this panel is the preview of
    // a list the walk view will later spell in title case. One house shown two
    // ways across those two screens reads as two houses.
    const byCoordinate = new Map<string, Map<string, DoorTally>>()
    for (const person of inside) {
      const key = `${person.lat}|${person.lng}`
      let doors = byCoordinate.get(key)
      if (!doors) {
        doors = new Map<string, DoorTally>()
        byCoordinate.set(key, doors)
      }
      const tally = doors.get(person.addressKey)
      if (tally) {
        tally.people += 1
      } else {
        // The first resident's line, matching how the create service freezes a
        // stop's. `inside` is sorted by addressKey then id above, so which
        // resident that is does not vary between two previews of one shape.
        doors.set(person.addressKey, {
          people: 1,
          displayAddress: person.displayAddress,
        })
      }
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
        doors: [...doorsAtStop.entries()].map(([addressKey, tally]) => ({
          // Cleaned against this door's own key rather than the whole stop's,
          // which is safe here and not in the serve: the line came off a
          // resident of this very door, so the unit on it is this door's.
          address: renderDoorAddress(
            addressKey,
            streetLineOfStop(tally.displayAddress, [addressKey]),
          ),
          people: tally.people,
        })),
      })
    }

    return { stops, doors, people: inside.length, locations }
  }
}
