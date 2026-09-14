import { DoorKnockingMode } from '@goodparty_org/contracts'
import { streetLineOfStop } from './unitAddress.util'

// Serpentine walk ordering: a turf's doors grouped into block faces, so a
// canvasser finishes one side of one street before crossing to the next.
//
// Geoapify is handed coordinates and a travel mode and nothing else — it has
// never been told what a street or a house number is — so it minimizes
// road-network travel time, and by that measure crossing a residential street
// is free (about a minute either way). The tours it returns are therefore
// correct and unwalkable: QA reported 3620 -> 3629 -> 3630 NE 64th Ave, two
// even-side neighbours with a trip across the street wedged between them,
// every leg logged as "1m walk".
//
// Re-optimizing the vendor's order locally does not fix that, which is the
// trap worth naming: crossing the street is a short DISTANCE as well as a
// short time, so a 2-opt pass over great-circle distance — or asking the
// vendor for `type: "short"` — reproduces the same zigzag. What makes the
// order bad is a domain fact that lives in neither metric. So the doors are
// grouped here, where the addresses are, and the vendor is demoted to
// ordering the groups, which is the part that genuinely is a routing problem.

// A house number, then the rest of the line. The `\S*` absorbs the forms a
// house number comes in that are not a bare integer — "1234B", "45-10" — so
// those still yield an integer to sort by instead of falling out of grouping
// entirely.
//
// KNOWN BROKEN for the Queens-style grid, and this is the honest limit of
// parsing an address as a string. There the side of the street is carried by
// the segment AFTER the hyphen, so "45-10" and "45-11" both reduce to 45:
// they land on one face, and since every "45-*" ties at the same house number
// the within-face sort falls through to addressKey order and interleaves both
// sides of the street — reproducing the zigzag this file exists to remove.
//
// Left alone rather than guessed at. "45-10" in Queens and "1234-B" elsewhere
// are the same shape, so telling them apart needs a locality signal that is
// not passed in here, and a rule that split on the hyphen would break the
// second case to fix the first. Not a regression either way: the vendor
// interleaved these before. Fixing it properly means giving the parser the
// state/county it is parsing for.
const HOUSE_NUMBER_LINE = /^(\d+)\S*\s+(.+)$/

// ~1 metre (1e-5 degrees of latitude is 1.11m; of longitude at US latitudes,
// less). Coarse enough that two voter rows for one building whose coordinates
// differ in the last decimal become one stop instead of two the vendor is then
// free to separate, fine enough that neighbouring buildings never merge.
const COORDINATE_GRID = 1e-5

const EARTH_RADIUS_METERS = 6_371_000

// Geoapify's own mode defaults, matching gp-webapp's travelMode.ts so a mode
// suggested before the buy and a leg written after it do not disagree: ~5 km/h
// on foot, ~25 km/h for the residential streets driven between doors.
const METERS_PER_SECOND: Record<DoorKnockingMode, number> = {
  walk: 5 / 3.6,
  drive: 25 / 3.6,
}

// A straight line between two doors is shorter than the trip between them —
// there is a sidewalk to follow and a path up to each porch. The same 1.3 the
// mode suggestion discounts by, applied here in the other direction.
const STREET_DETOUR_FACTOR = 1.3

// Which end of a face is walked first. Not a free choice: a face entered at
// the wrong end costs a whole block face to walk back.
const FORWARD = 0
const BACKWARD = 1

// Equirectangular rather than haversine, for the reason gp-webapp's twin
// gives: every pair compared here sits inside one turf, where the two agree to
// well under a metre. Duplicated rather than shared because the two packages
// have no common runtime — the constants above are the part that must not
// drift.
export const metersBetween = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number => {
  const radians = Math.PI / 180
  const dx =
    (b.lng - a.lng) * radians * Math.cos(((a.lat + b.lat) / 2) * radians)
  const dy = (b.lat - a.lat) * radians
  return Math.sqrt(dx * dx + dy * dy) * EARTH_RADIUS_METERS
}

// The key a stop is deduped under. Snapped rather than exact so that one
// physical building is one stop; the stop still keeps the real coordinate of
// whichever resident arrived first, because this is a grouping key and not a
// position.
export const coordinateKey = (lat: number, lng: number): string =>
  `${Math.round(lat / COORDINATE_GRID)}|${Math.round(lng / COORDINATE_GRID)}`

// What grouping needs of a stop. Deliberately narrower than PlannedStop so the
// ordering can be unit-tested on addresses alone.
export type BlockFaceStop = {
  lat: number
  lng: number
  displayAddress: string
  // Every door beneath this stop, so the unit can be taken back off the
  // frozen line before it is parsed. See streetLineOfStop. Shaped as the
  // people list a PlannedStop already carries, so one satisfies the other.
  people: Array<{ addressKey: string }>
}

export type BlockFace = {
  // Indices into the stop array this face was grouped from, ascending by
  // house number. Doors that tie keep their input order, which is
  // addressKey-sorted upstream and so is stable across identical turfs.
  stopIndexes: number[]
  // `<STREET>|<parity>`, or `?<index>` for a line that named no house number.
  // Carried for tests and logs; nothing reads it as data.
  key: string
}

type ParsedAddress = { houseNumber: number; streetKey: string }

const parseStreetAddress = (stop: BlockFaceStop): ParsedAddress | null => {
  // The stop's own doors are what clean the unit off the line, rather than a
  // guess by shape: "205 BENTON DR APT 8309" and a street genuinely named
  // "... Apt" are the same pattern.
  const streetLine = streetLineOfStop(
    stop.displayAddress,
    stop.people.map((person) => person.addressKey),
  )
  const match = HOUSE_NUMBER_LINE.exec(streetLine.trim())
  if (!match) return null
  const houseNumber = Number(match[1])
  if (!Number.isSafeInteger(houseNumber)) return null
  // Compared for equality and never interpreted, which is the whole reason
  // parsing is safe here: "S 5678 W" on the Utah grid and "NORTH AVE" need to
  // group, not to be understood.
  const streetKey = (match[2] ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  if (!streetKey) return null
  return { houseNumber, streetKey }
}

// One side of one street, in house-number order. Faces come back in the order
// their first door appeared, which is addressKey order, so the same turf always
// produces the same faces and the same vendor request.
export const groupIntoBlockFaces = (stops: BlockFaceStop[]): BlockFace[] => {
  const byKey = new Map<string, Array<{ index: number; houseNumber: number }>>()
  const keyOrder: string[] = []

  stops.forEach((stop, index) => {
    const parsed = parseStreetAddress(stop)
    // A line no house number can be read out of gets a face of its own, so it
    // keeps the vendor-ordered behaviour it has today rather than being
    // guessed into somebody else's block.
    const key = parsed
      ? `${parsed.streetKey}|${parsed.houseNumber % 2}`
      : `?${index}`
    let entries = byKey.get(key)
    if (!entries) {
      entries = []
      byKey.set(key, entries)
      keyOrder.push(key)
    }
    entries.push({ index, houseNumber: parsed?.houseNumber ?? 0 })
  })

  return keyOrder.map((key) => {
    const entries = byKey.get(key) ?? []
    const sorted = entries
      .map((entry, position) => ({ ...entry, position }))
      // Stable: equal house numbers keep the order they arrived in.
      .sort((a, b) => a.houseNumber - b.houseNumber || a.position - b.position)
    return { key, stopIndexes: sorted.map((entry) => entry.index) }
  })
}

// The single stop that stands in for a face in the vendor request: the one
// nearest the face's centre, so the leg measured to it is the least wrong it
// can be for a face entered at either end.
export const representativeOf = (
  face: BlockFace,
  stops: BlockFaceStop[],
): number => {
  const members = face.stopIndexes
  const first = members[0]
  if (first === undefined) return 0
  if (members.length === 1) return first

  let latSum = 0
  let lngSum = 0
  for (const index of members) {
    const stop = stops[index]
    if (!stop) continue
    latSum += stop.lat
    lngSum += stop.lng
  }
  const centre = { lat: latSum / members.length, lng: lngSum / members.length }

  let best = first
  let bestDistance = Infinity
  for (const index of members) {
    const stop = stops[index]
    if (!stop) continue
    const distance = metersBetween(centre, stop)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  }
  return best
}

export type SequencedRoute = {
  // Indices into the stop array, in walk order.
  stopIndexes: number[]
  // The leg INTO each stop of `stopIndexes`, aligned with it.
  legSeconds: number[]
  legMeters: number[]
  totalSeconds: number
  totalMeters: number
}

const legFromMeters = (
  meters: number,
  mode: DoorKnockingMode,
): { seconds: number; meters: number } => {
  const travelled = meters * STREET_DETOUR_FACTOR
  return {
    meters: Math.round(travelled),
    seconds: Math.round(travelled / METERS_PER_SECOND[mode]),
  }
}

// Given the face order the vendor chose, walk each face from whichever end
// makes the transitions between them shortest.
//
// Choosing all of the directions at once is a shortest path over two nodes per
// face, so it is solved exactly rather than alternated blindly — blind
// alternation only happens to be right when the faces arrive in adjacent
// antiparallel pairs, and it is the first face that suffers when they do not.
const orientFaces = (
  faces: BlockFace[],
  faceOrder: number[],
  stops: BlockFaceStop[],
): number[] => {
  const endpointsOf = (position: number, orientation: number) => {
    const face = faces[faceOrder[position] ?? 0]
    const members = face?.stopIndexes ?? []
    const ascending = members[0]
    const descending = members[members.length - 1]
    const startIndex = orientation === FORWARD ? ascending : descending
    const endIndex = orientation === FORWARD ? descending : ascending
    return {
      start: stops[startIndex ?? 0],
      end: stops[endIndex ?? 0],
    }
  }

  const cost = faceOrder.map(() => [Infinity, Infinity])
  const cameFrom = faceOrder.map(() => [FORWARD, FORWARD])
  // No history before the first face, so both of its directions start even and
  // the tie resolves to FORWARD — ascending house numbers.
  cost[0] = [0, 0]

  for (let position = 1; position < faceOrder.length; position++) {
    for (const orientation of [FORWARD, BACKWARD]) {
      const { start } = endpointsOf(position, orientation)
      for (const previous of [FORWARD, BACKWARD]) {
        const { end } = endpointsOf(position - 1, previous)
        const reach = cost[position - 1]?.[previous] ?? Infinity
        if (!start || !end || !Number.isFinite(reach)) continue
        const candidate = reach + metersBetween(end, start)
        if (candidate < (cost[position]?.[orientation] ?? Infinity)) {
          const row = cost[position]
          const trail = cameFrom[position]
          if (row) row[orientation] = candidate
          if (trail) trail[orientation] = previous
        }
      }
    }
  }

  const last = faceOrder.length - 1
  const finalRow = cost[last] ?? [0, 0]
  let orientation =
    (finalRow[BACKWARD] ?? Infinity) < (finalRow[FORWARD] ?? Infinity)
      ? BACKWARD
      : FORWARD
  const chosen = faceOrder.map(() => FORWARD)
  for (let position = last; position >= 0; position--) {
    chosen[position] = orientation
    orientation = cameFrom[position]?.[orientation] ?? FORWARD
  }
  return chosen
}

// Expand the vendor's face order into a door order, with the legs between
// them.
export const sequenceBlockFaces = (args: {
  stops: BlockFaceStop[]
  faces: BlockFace[]
  // Face order the vendor chose, as indices into `faces`.
  faceOrder: number[]
  // The vendor's leg INTO each face of `faceOrder`, aligned with it.
  faceLegSeconds: number[]
  faceLegMeters: number[]
  mode: DoorKnockingMode
  loop: boolean
}): SequencedRoute => {
  const { stops, faces, faceOrder, mode } = args
  const orientation = orientFaces(faces, faceOrder, stops)

  const stopIndexes: number[] = []
  const legSeconds: number[] = []
  const legMeters: number[] = []

  faceOrder.forEach((faceIndex, position) => {
    const members = faces[faceIndex]?.stopIndexes ?? []
    const ordered =
      orientation[position] === BACKWARD ? [...members].reverse() : members

    ordered.forEach((stopIndex, withinFace) => {
      if (withinFace === 0) {
        // Crossing into a new block face is the part of the walk that uses
        // roads, so it keeps the vendor's measured leg. The vendor measured it
        // between the two faces' representatives rather than between the doors
        // actually left and entered, so it carries up to half a face of
        // overlap with the local legs below — an overestimate, which is the
        // safe direction for a number a canvasser plans an evening around.
        legSeconds.push(args.faceLegSeconds[position] ?? 0)
        legMeters.push(args.faceLegMeters[position] ?? 0)
      } else {
        // Two doors on one side of one street: the sidewalk between them is
        // the straight line, so crow-flies here is close to a measurement
        // rather than the estimate it would be across a block.
        const previous = stops[ordered[withinFace - 1] ?? 0]
        const current = stops[stopIndex]
        const leg =
          previous && current
            ? legFromMeters(metersBetween(previous, current), mode)
            : { seconds: 0, meters: 0 }
        legSeconds.push(leg.seconds)
        legMeters.push(leg.meters)
      }
      stopIndexes.push(stopIndex)
    })
  })

  let totalSeconds = legSeconds.reduce((sum, value) => sum + value, 0)
  let totalMeters = legMeters.reduce((sum, value) => sum + value, 0)

  // A closed tour owes one more leg than it has stops: the trip home belongs
  // to no door, exactly as the vendor reports it, so it is totalled and
  // nowhere else.
  const first = stops[stopIndexes[0] ?? 0]
  const final = stops[stopIndexes[stopIndexes.length - 1] ?? 0]
  if (args.loop && first && final && stopIndexes.length > 1) {
    const home = legFromMeters(metersBetween(final, first), mode)
    totalSeconds += home.seconds
    totalMeters += home.meters
  }

  return { stopIndexes, legSeconds, legMeters, totalSeconds, totalMeters }
}
