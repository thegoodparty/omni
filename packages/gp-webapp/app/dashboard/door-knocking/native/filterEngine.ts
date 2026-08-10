import { DecodedPack } from './packDecoder'

// Per-dim selections: dim key -> set of ALLOWED byte values. A dim absent
// from the map (or with every value selected) doesn't constrain.
export type DimSelections = Map<string, Set<number>>

export interface FilterResult {
  people: number
  households: number
  dots: number
  // Matched people per dot — a dot with 0 renders dimmed.
  matchedPerDot: Uint32Array
  // Most-actionable canvass status byte among each dot's matched people.
  // The DOOR_KNOCK_STATUSES array order IS the actionability order, so the
  // minimum byte wins; 255 = no matched people at the dot.
  statusPerDot: Uint8Array
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

  const active: Array<{ plane: Uint8Array; mask: Uint8Array }> = []
  for (const dim of manifest.dims) {
    const selected = selections.get(dim.key)
    if (!selected || selected.size >= dim.values.length) continue
    const mask = new Uint8Array(dim.values.length)
    for (const value of selected) mask[value] = 1
    const plane = dimPlanes.get(dim.key)
    if (plane) active.push({ plane, mask })
  }

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

  let dots = 0
  for (let i = 0; i < dotCount; i++) {
    if ((matchedPerDot[i] ?? 0) > 0) dots++
  }

  return { people, households, dots, matchedPerDot, statusPerDot }
}

export interface PolygonStats {
  stops: number
  people: number
}

// Ray-cast every dot against the drawn ring (bbox prefiltered) and sum the
// current filter's matches — the live "what would this turf hold" readout.
// Counts stops (unique coordinates), the same unit the 150 cap uses.
export const polygonStats = (
  pack: DecodedPack,
  matchedPerDot: Uint32Array,
  ring: Array<[number, number]>,
): PolygonStats => {
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

  let stops = 0
  let people = 0
  const dotCount = matchedPerDot.length
  for (let i = 0; i < dotCount; i++) {
    const matched = matchedPerDot[i] ?? 0
    if (matched === 0) continue
    const x = positions[i * 2] ?? 0
    const y = positions[i * 2 + 1] ?? 0
    if (x < minX || x > maxX || y < minY || y > maxY) continue
    if (!pointInRing(x, y, ring)) continue
    stops++
    people += matched
  }
  return { stops, people }
}

// Restrict a filter result to the dots inside a turf polygon: dots outside
// zero out (they render as unmatched grey) and the counts describe only the
// turf. Used when a saved list is selected on the landing map.
export const maskToPolygon = (
  pack: DecodedPack,
  result: FilterResult,
  ring: Array<[number, number]>,
): FilterResult => {
  const { positions, householdToDot } = pack
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
  let dots = 0
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
    dots++
  }
  // Household count is dot-granular here (any household at a matched dot),
  // a slight overcount vs runFilter's person-level rollup — fine for the
  // rail readout, and the canonical count is knock-time evaluation anyway.
  let households = 0
  for (let h = 0; h < householdToDot.length; h++) {
    const dot = householdToDot[h] ?? 0
    if ((matchedPerDot[dot] ?? 0) > 0) households++
  }
  return { people, households, dots, matchedPerDot, statusPerDot }
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
