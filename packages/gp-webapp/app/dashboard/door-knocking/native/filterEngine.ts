import { DecodedPack } from './packDecoder'
import { groupAgeSlices, type DimSlice } from './audienceMix'

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
  // The DOOR_KNOCK_STATUSES array order IS the actionability order, so the
  // minimum byte wins; 255 = no matched people at the dot.
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
    if (status < (statusPerDot[dot] ?? 255)) {
      statusPerDot[dot] = status
    }
  }

  return { people, households, matchedPerDot, statusPerDot }
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

// Per-status person counts for the scope a rail heading names: the whole pack
// when `ring` is null, otherwise only the people whose dot falls inside a
// turf's polygon. The landing legend was reading the raw canvassStatus plane,
// so selecting a turf renamed the heading and left seven district-wide numbers
// underneath it describing a different audience.
//
// `selections` is the scope's own filters, deliberately NOT the legend's own
// chip narrowing: a legend that zeroed every status but the pressed one would
// leave no count to press back.
export const canvassStatusCounts = (
  pack: DecodedPack,
  selections: DimSelections,
  ring: Array<[number, number]> | null,
): number[] => {
  const { personToHousehold, householdToDot, dimPlanes, manifest } = pack
  const dim = manifest.dims.find((entry) => entry.key === 'canvassStatus')
  const plane = dimPlanes.get('canvassStatus')
  const counts = new Array<number>(dim?.values.length ?? 0).fill(0)
  if (!dim || !plane) return counts

  const insideDot = ring ? dotsInRing(pack, ring) : null
  const active = activeDimMasks(pack, selections)

  outer: for (let i = 0; i < personToHousehold.length; i++) {
    for (let a = 0; a < active.length; a++) {
      const entry = active[a]
      if (entry && !entry.mask[entry.plane[i] ?? 0]) continue outer
    }
    if (insideDot) {
      const dot = householdToDot[personToHousehold[i] ?? 0] ?? 0
      if (!insideDot[dot]) continue
    }
    const status = plane[i] ?? 0
    if (status < counts.length) counts[status] = (counts[status] ?? 0) + 1
  }

  return counts
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
