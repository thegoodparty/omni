import { DecodedPack } from './packDecoder'
import { groupAgeSlices, type DimSlice } from './audienceMix'
import { statusByteActionability } from './statusPresentation'

// Per-dim selections: dim key -> set of ALLOWED byte values. A dim absent
// from the map (or with every value selected) doesn't constrain.
export type DimSelections = Map<string, Set<number>>

export interface FilterResult {
  people: number
  // Present only on a district-wide pass. `maskToPolygon` leaves it off
  // because no surface reads a household count off a masked result: the one
  // reader is the create flow's `districtHouseholds`, which renders only while
  // the flow is open, and the mask runs only while it is closed. Optional
  // rather than a sentinel so that interlock is the compiler's to enforce.
  households?: number
  // Matched people per dot — a dot with 0 renders dimmed.
  matchedPerDot: Uint32Array
  // Most-actionable canvass status byte among each dot's matched people.
  // Ranked through `statusByteActionability` and NOT by the byte itself: the
  // byte is an index into `DOOR_KNOCK_STATUSES`, which the Serve statuses were
  // appended to so that packs already on phones keep decoding — so a raw
  // comparison would rank a Serve conversation below every way a door can
  // fail. 255 = no matched people at the dot.
  statusPerDot: Uint8Array
}

interface ActiveDim {
  plane: Uint8Array
  mask: Uint8Array
}

// A dim only constrains when the selection leaves something out, so a fully
// selected (or absent) dim is dropped here rather than tested per person.
const activeDimMasks = (
  pack: DecodedPack,
  selections: DimSelections,
): ActiveDim[] => {
  const active: ActiveDim[] = []
  for (const dim of pack.manifest.dims) {
    const selected = selections.get(dim.key)
    if (!selected || selected.size >= dim.values.length) continue
    const mask = new Uint8Array(dim.values.length)
    for (const value of selected) mask[value] = 1
    const plane = pack.dimPlanes.get(dim.key)
    if (plane) active.push({ plane, mask })
  }
  return active
}

// One pass over every person (the POC measured ~31ms for 1.67M people):
// apply the active dim masks, then roll matches up person → household → dot.
export const runFilter = (
  pack: DecodedPack,
  selections: DimSelections,
): FilterResult => {
  const { personToHousehold, householdToDot, dimPlanes, manifest } = pack
  const peopleCount = personToHousehold.length
  const dotCount = manifest.counts.dots

  const active = activeDimMasks(pack, selections)

  const canvassPlane = dimPlanes.get('canvassStatus')
  const matchedPerDot = new Uint32Array(dotCount)
  const statusPerDot = new Uint8Array(dotCount).fill(255)
  const householdSeen = new Uint8Array(manifest.counts.households)

  let people = 0
  let households = 0
  outer: for (let i = 0; i < peopleCount; i++) {
    for (let a = 0; a < active.length; a++) {
      const entry = active[a]
      if (entry && !entry.mask[entry.plane[i] ?? 0]) continue outer
    }
    people++
    const household = personToHousehold[i] ?? 0
    const dot = householdToDot[household] ?? 0
    matchedPerDot[dot] = (matchedPerDot[dot] ?? 0) + 1
    if (!householdSeen[household]) {
      householdSeen[household] = 1
      households++
    }
    const status = canvassPlane?.[i] ?? 0
    const current = statusPerDot[dot] ?? 255
    if (statusByteActionability(status) < statusByteActionability(current)) {
      statusPerDot[dot] = status
    }
  }

  return { people, households, matchedPerDot, statusPerDot }
}

// A dot's coordinate as a comparable key. Both sides are rounded to f32 first:
// `positions` is a Float32Array and a route stop's lat/lng is the same value
// still at double width, so the two agree only once the stop has been through
// the same narrowing the pack's encoder put the dot through.
const dotKey = (lng: number, lat: number): string =>
  `${Math.fround(lng)},${Math.fround(lat)}`

// Fold the doors logged on this device into a filter result, so a walk shows on
// the map without re-downloading the district it was cut from.
//
// The merge is a MAX and never a rewrite, because knocking can only ever make a
// door less actionable and `runFilter` reports the most actionable status at a
// dot — so a dot the pack already answered for keeps what it had, and a
// coordinate with no dot behind it is dropped rather than guessed at.
//
// Where it over-reports is any coordinate whose residents are not all on the
// turf, because the two sides roll up over different populations: the stop over
// the turf's filtered targets, the dot over everyone the pack put at that
// coordinate. A block of flats is the loud version of it (the pack groups
// households at `AddressLine` while a stop carries the apartment — ADR 0010),
// but the common one is smaller and worth naming: a party-filtered turf that
// took one half of a mixed-party couple colours the house for both of them.
//
// The exact answer is only knowable from the per-person statuses, which live on
// the server side of the pack build — and asking for them means the same
// tens-of-seconds district download this exists to avoid, on the one gesture
// whose next frame is a navigation away from the map. It errs toward "already
// knocked", which costs a second look at a door rather than a missed one.
export const applyLoggedKnocks = (
  pack: DecodedPack,
  result: FilterResult,
): FilterResult => {
  const knocks = pack.loggedKnocks
  // The overwhelming case, and the reason this is a guard rather than a branch
  // inside the loop: without a walk behind it the pass below is a scan of every
  // dot in the district on every filter pill the create flow toggles.
  if (!knocks || knocks.length === 0) return result

  const byDot = new Map<string, number>()
  for (const knock of knocks) {
    const key = dotKey(knock.lng, knock.lat)
    const current = byDot.get(key)
    // Most actionable wins among doors sharing a coordinate, which is the same
    // rule `runFilter` rolls a dot's people up by.
    if (
      current === undefined ||
      statusByteActionability(knock.status) < statusByteActionability(current)
    ) {
      byDot.set(key, knock.status)
    }
  }

  const { positions } = pack
  const statusPerDot = result.statusPerDot.slice()
  for (let dot = 0; dot < statusPerDot.length; dot++) {
    const logged = byDot.get(
      dotKey(positions[dot * 2] ?? 0, positions[dot * 2 + 1] ?? 0),
    )
    if (logged === undefined) continue
    const current = statusPerDot[dot] ?? 255
    // A dot with no matched people keeps its sentinel rather than taking a
    // logged knock: it is not on this filter, and 255 is what dims it.
    if (current === 255) continue
    if (statusByteActionability(logged) > statusByteActionability(current)) {
      statusPerDot[dot] = logged
    }
  }
  return { ...result, statusPerDot }
}

// Defined in audienceMix and re-exported here, where its consumers already
// look for it: this module needs audienceMix's age grouping, and importing the
// type back the other way would make the pair circular.
export type { DimSlice }

export interface PolygonStats {
  stops: number
  people: number
  households: number
  // Biggest bucket first, empty buckets dropped.
  partyMix: DimSlice[]
  // Same shape and the same pass, for the only other dim a FROZEN ROUTE can
  // also answer (its targets carry a live age and party and nothing else).
  // Every other dim the pack carries — education, income, ethnicity and ten
  // more — would build a breakdown that emptied itself the moment the list
  // was knocked, so the sheet reports the two both sources have.
  ageMix: DimSlice[]
}

// Ray-cast the dots once (bbox prefiltered) so a person pass is a lookup per
// voter rather than a point-in-polygon test per voter.
const dotsInRing = (
  pack: DecodedPack,
  ring: Array<[number, number]>,
): Uint8Array => {
  const { positions, manifest } = pack
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const dotCount = manifest.counts.dots
  const insideDot = new Uint8Array(dotCount)
  for (let i = 0; i < dotCount; i++) {
    const x = positions[i * 2] ?? 0
    const y = positions[i * 2 + 1] ?? 0
    if (x < minX || x > maxX || y < minY || y > maxY) continue
    if (!pointInRing(x, y, ring)) continue
    insideDot[i] = 1
  }
  return insideDot
}

// Everything the draw step reports about the shape being drawn, all on the
// one denominator that matters there: what is INSIDE the ring. A district-wide
// number next to an in-polygon one is how the footer previously managed to
// read "12,000 matching households · 84 selected doors".
//
// The households count is person-level exact — a household counts only when a
// person in it survives the filter — so it matches what runFilter would report
// for the same audience, restricted to the ring.
export const polygonStats = (
  pack: DecodedPack,
  selections: DimSelections,
  ring: Array<[number, number]>,
): PolygonStats => {
  const { personToHousehold, householdToDot, dimPlanes, manifest } = pack
  const dotCount = manifest.counts.dots
  const insideDot = dotsInRing(pack, ring)

  const active = activeDimMasks(pack, selections)
  const partyDim = manifest.dims.find((dim) => dim.key === 'party')
  const partyPlane = dimPlanes.get('party')
  const partyPeople = new Array<number>(partyDim?.values.length ?? 0).fill(0)
  const ageDim = manifest.dims.find((dim) => dim.key === 'age')
  const agePlane = dimPlanes.get('age')
  const agePeople = new Array<number>(ageDim?.values.length ?? 0).fill(0)

  const dotSeen = new Uint8Array(dotCount)
  const householdSeen = new Uint8Array(manifest.counts.households)
  let stops = 0
  let people = 0
  let households = 0
  outer: for (let i = 0; i < personToHousehold.length; i++) {
    for (let a = 0; a < active.length; a++) {
      const entry = active[a]
      if (entry && !entry.mask[entry.plane[i] ?? 0]) continue outer
    }
    const household = personToHousehold[i] ?? 0
    const dot = householdToDot[household] ?? 0
    if (!insideDot[dot]) continue
    people++
    if (!dotSeen[dot]) {
      dotSeen[dot] = 1
      stops++
    }
    if (!householdSeen[household]) {
      householdSeen[household] = 1
      households++
    }
    const party = partyPlane?.[i] ?? 0
    if (party < partyPeople.length) {
      partyPeople[party] = (partyPeople[party] ?? 0) + 1
    }
    const age = agePlane?.[i] ?? 0
    if (age < agePeople.length) {
      agePeople[age] = (agePeople[age] ?? 0) + 1
    }
  }

  const partyMix = (partyDim?.values ?? [])
    .map((label, index) => ({ label, people: partyPeople[index] ?? 0 }))
    .filter((slice) => slice.people > 0)
    .sort((a, b) => b.people - a.people)
  // Age is the one dim whose buckets are finer than anyone should be shown:
  // they are cut so every saved-list age key maps onto them exactly, which
  // costs three single-year buckets. `groupAgeSlices` rolls them up into the
  // display bands, and re-sorts, since summing changes the order.
  const ageMix = groupAgeSlices(
    (ageDim?.values ?? [])
      .map((label, index) => ({ label, people: agePeople[index] ?? 0 }))
      .filter((slice) => slice.people > 0),
  )

  return { stops, people, households, partyMix, ageMix }
}

// Restrict a filter result to the dots inside a turf polygon: dots outside
// zero out (they render as unmatched grey) and the people count describes only
// the turf. Used when a saved list is selected on the landing map.
export const maskToPolygon = (
  pack: DecodedPack,
  result: FilterResult,
  ring: Array<[number, number]>,
): FilterResult => {
  const { positions } = pack
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const matchedPerDot = new Uint32Array(result.matchedPerDot.length)
  const statusPerDot = new Uint8Array(result.statusPerDot.length).fill(255)
  let people = 0
  for (let i = 0; i < result.matchedPerDot.length; i++) {
    const matched = result.matchedPerDot[i] ?? 0
    if (matched === 0) continue
    const x = positions[i * 2] ?? 0
    const y = positions[i * 2 + 1] ?? 0
    if (x < minX || x > maxX || y < minY || y > maxY) continue
    if (!pointInRing(x, y, ring)) continue
    matchedPerDot[i] = matched
    statusPerDot[i] = result.statusPerDot[i] ?? 255
    people += matched
  }
  return { people, matchedPerDot, statusPerDot }
}

const pointInRing = (
  x: number,
  y: number,
  ring: Array<[number, number]>,
): boolean => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] ?? [0, 0]
    const [xj, yj] = ring[j] ?? [0, 0]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}
