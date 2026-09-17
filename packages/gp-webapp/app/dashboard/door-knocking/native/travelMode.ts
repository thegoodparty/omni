import { DoorKnockingMode } from '@goodparty_org/contracts'
import { DimSelections, maskToPolygon, runFilter } from './filterEngine'
import { DecodedPack } from './packDecoder'

// Geoapify's own mode defaults, near enough: ~5 km/h on foot, and ~25 km/h for
// the residential streets a canvasser drives between doors. Only ever applied
// to the mode we did NOT buy — the bought mode's duration is the vendor's own
// totalSeconds and is never replaced by arithmetic.
const METERS_PER_SECOND: Record<DoorKnockingMode, number> = {
  walk: 5 / 3.6,
  drive: 25 / 3.6,
}

// The prototype's rule, and the source of truth here: a list is walkable only
// when EVERY leg between consecutive stops is under a five-minute walk;
// otherwise the whole list is a drive list. No mixing — one mode buys one
// route.
export const WALKABLE_LEG_SECONDS = 300

// Crow-flies, because the pack carries coordinates and no street network, and
// a real walk between two doors is longer than the straight line — so the
// straight line is discounted before it becomes minutes. Erring toward `drive`
// is the cheaper mistake: the path we buy is mode-specific and can never be
// re-bought, while a suggestion is one tap to override.
const STREET_DETOUR_FACTOR = 1.3

export const WALKABLE_LEG_METERS =
  (WALKABLE_LEG_SECONDS * METERS_PER_SECOND.walk) / STREET_DETOUR_FACTOR

const EARTH_RADIUS_METERS = 6_371_000

// Equirectangular rather than haversine: every pair compared here is inside one
// turf, where the two agree to well under a metre, and this runs O(n^2) times.
const metersBetween = (
  [lngA, latA]: [number, number],
  [lngB, latB]: [number, number],
): number => {
  const radians = Math.PI / 180
  const dx =
    (lngB - lngA) * radians * Math.cos((((latA + latB) / 2) * Math.PI) / 180)
  const dy = (latB - latA) * radians
  return Math.sqrt(dx * dx + dy * dy) * EARTH_RADIUS_METERS
}

// The longest hop in the shortest chain that still reaches every stop — the
// minimum spanning tree's widest edge. Visit order is Geoapify's and does not
// exist yet, so "between consecutive stops" is read as the best case available
// to any order: under the threshold some walking order has no long leg in it,
// over it every order has at least one. Prim's, O(n^2) over at most 150 stops.
const longestChainLegMeters = (stops: Array<[number, number]>): number => {
  const count = stops.length
  const first = stops[0]
  if (count < 2 || !first) return 0

  const reached = new Uint8Array(count)
  const gap = new Float64Array(count).fill(Infinity)
  reached[0] = 1
  for (let i = 1; i < count; i++) {
    const stop = stops[i]
    if (stop) gap[i] = metersBetween(first, stop)
  }

  let longest = 0
  for (let joinedCount = 1; joinedCount < count; joinedCount++) {
    let next = -1
    let nextGap = Infinity
    for (let i = 0; i < count; i++) {
      if (reached[i]) continue
      const candidate = gap[i] ?? Infinity
      if (candidate < nextGap) {
        nextGap = candidate
        next = i
      }
    }
    if (next === -1) break
    reached[next] = 1
    if (nextGap > longest) longest = nextGap
    const joined = stops[next]
    if (!joined) continue
    for (let i = 0; i < count; i++) {
      if (reached[i]) continue
      const stop = stops[i]
      if (!stop) continue
      const distance = metersBetween(joined, stop)
      if (distance < (gap[i] ?? Infinity)) gap[i] = distance
    }
  }
  return longest
}

// Which mode to preselect in the knock dialog, from how spread out the list's
// own stops are. A suggestion only — the choice becomes permanent the moment
// the route is bought, so the point is that the default is usually right and an
// override is deliberate, not that the candidate is overruled.
export const suggestTravelMode = (
  stops: Array<[number, number]>,
): DoorKnockingMode =>
  longestChainLegMeters(stops) <= WALKABLE_LEG_METERS ? 'walk' : 'drive'

// The stops the pack puts inside a saved turf's ring, as [lng, lat] pairs.
// Exactly the dot set polygonStats counts as `stops`, so the suggestion is
// derived from the same geometry the draw step and the details sheet report —
// and it is available before the billed, irreversible route call, which is the
// only moment the mode is still a choice.
export const stopPositionsInRing = (
  pack: DecodedPack,
  selections: DimSelections,
  ring: Array<[number, number]>,
): Array<[number, number]> => {
  const inRing = maskToPolygon(pack, runFilter(pack, selections), ring)
  const stops: Array<[number, number]> = []
  for (let dot = 0; dot < inRing.matchedPerDot.length; dot++) {
    if ((inRing.matchedPerDot[dot] ?? 0) === 0) continue
    stops.push([pack.positions[dot * 2] ?? 0, pack.positions[dot * 2 + 1] ?? 0])
  }
  return stops
}

// What the other mode would have taken over the path we actually bought. The
// route row is never rewritten and the stored pathGeometry is the bought mode's
// alone, so this converts a fixed distance at a different speed rather than
// implying a second route exists.
export const estimateTravelSeconds = (
  totalMeters: number,
  mode: DoorKnockingMode,
): number => Math.round(totalMeters / METERS_PER_SECOND[mode])
