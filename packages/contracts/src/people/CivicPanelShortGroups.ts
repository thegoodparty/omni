import type { UnderrepresentedGroup } from '../priorities/PriorityResults.schema'
import type {
  CivicPanelComposition,
  CivicPanelCompositionPlace,
} from './CivicPanelSummary.schema'

// The civic panel's goal as 100 seats, and which groups have fewer seats
// than their share of the district. The webapp's civic panel page and
// gp-api's Chief of Staff read the same groups from here, so the page and
// the chat never name different ones.

export const CIVIC_PANEL_SEAT_COUNT = 100

// Largest remainder, ties to the bigger weight, so the parts always sum to
// the total. A part never passes its cap.
export const allocateSeats = (
  weights: number[],
  total: number,
  caps?: number[],
): number[] => {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0 || total <= 0) return weights.map(() => 0)
  const capOf = (i: number) => caps?.[i] ?? Infinity
  const raw = weights.map((w) => (w * total) / sum)
  const out = raw.map((r, i) => Math.min(Math.floor(r), capOf(i)))
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = raw
    .map((_, i) => i)
    .sort(
      (a, b) =>
        (raw[b] ?? 0) - (out[b] ?? 0) - ((raw[a] ?? 0) - (out[a] ?? 0)) ||
        (weights[b] ?? 0) - (weights[a] ?? 0),
    )
  // Caps can leave seats over after one pass; keep going while any part
  // still has room.
  while (left > 0) {
    let placed = false
    for (const i of order) {
      if (left <= 0) break
      if ((out[i] ?? 0) >= capOf(i) || (weights[i] ?? 0) <= 0) continue
      out[i] = (out[i] ?? 0) + 1
      left -= 1
      placed = true
    }
    if (!placed) break
  }
  return out
}

export interface PlaceSeats {
  // Of the 100, by the place's share of the district.
  count: number
  // Filled by its members, only up to its share of the goal.
  filled: number
}

// Each place's seats of the 100 and how many its members fill. A place's
// members fill seats only up to its share of the goal, and a place with no
// seat fills none.
export const placeSeats = ({
  places,
  goal,
}: {
  places: CivicPanelCompositionPlace[]
  goal: number
}): PlaceSeats[] => {
  const target = Math.max(1, goal)
  const shareSum = places.reduce((a, p) => a + p.districtShare, 0) || 1
  const shares = places.map((p) => p.districtShare / shareSum)
  const seatsFor = allocateSeats(shares, CIVIC_PANEL_SEAT_COUNT)
  const counted = places.map((p, i) =>
    (seatsFor[i] ?? 0) > 0 ? Math.min(p.members, (shares[i] ?? 0) * target) : 0,
  )
  const filledTotal = Math.min(
    CIVIC_PANEL_SEAT_COUNT,
    Math.round(
      (counted.reduce((a, b) => a + b, 0) / target) * CIVIC_PANEL_SEAT_COUNT,
    ),
  )
  // Never more seats than a place's own members earn, nor than it has.
  const earned = counted.map((c, i) =>
    Math.min(
      seatsFor[i] ?? 0,
      Math.ceil((c / target) * CIVIC_PANEL_SEAT_COUNT),
    ),
  )
  const filledFor = allocateSeats(counted, filledTotal, earned)
  return places.map((_, i) => ({
    count: seatsFor[i] ?? 0,
    filled: filledFor[i] ?? 0,
  }))
}

export type CivicPanelShortGroup =
  | {
      kind: 'group'
      key: string
      group: UnderrepresentedGroup
      have: number
      need: number
    }
  | {
      kind: 'place'
      key: string
      place: CivicPanelCompositionPlace
      have: number
      need: number
    }

// Every group with fewer seats than its share of the district, furthest
// behind first, in seats of the 100: an age, gender or race group's share
// of the seats beside the seats its members fill, and a place's seats
// beside the ones filled.
export const civicPanelShortGroups = ({
  composition,
  members,
  goal,
}: {
  composition: CivicPanelComposition
  members: number
  goal: number
}): CivicPanelShortGroup[] => {
  const fill = members / Math.max(1, goal)
  const groups: CivicPanelShortGroup[] = composition.groups.map((g) => ({
    kind: 'group',
    key: g.group,
    group: g.group,
    have: Math.round(g.memberShare * fill * CIVIC_PANEL_SEAT_COUNT),
    need: Math.round(g.districtShare * CIVIC_PANEL_SEAT_COUNT),
  }))
  const seats = placeSeats({ places: composition.places, goal })
  const places: CivicPanelShortGroup[] = composition.places.flatMap(
    (place, i): CivicPanelShortGroup[] => {
      const seat = seats[i]
      return seat && seat.count > 0
        ? [
            {
              kind: 'place',
              key: place.key,
              place,
              have: seat.filled,
              need: seat.count,
            },
          ]
        : []
    },
  )
  return [...groups, ...places]
    .filter((row) => row.need > 0 && row.have < row.need)
    .sort((a, b) => a.have / a.need - b.have / b.need || b.need - a.need)
}

// How many short groups the civic panel page shows before See every group,
// and the Chief of Staff offers.
export const CIVIC_PANEL_SHORT_GROUPS_SHOWN = 4
