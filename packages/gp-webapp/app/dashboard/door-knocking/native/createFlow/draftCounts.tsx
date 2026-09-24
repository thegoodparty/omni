import type { PolygonStats } from '../filterEngine'

interface DraftCountsProps {
  // The pack's answer for this boundary, or null while the pack is still
  // decoding. Null prints an em dash rather than a zero: a count that has not
  // arrived is not a count of nothing.
  stats: PolygonStats | null
}

// What one unbought turf is worth, in the one wording both surfaces that list
// turfs use — the draw step's cards and the drawing surface's panel. They are
// never on screen together and their layouts are nothing alike, so only the
// SENTENCE is shared; each owns its own row.
//
// Stops, and only stops. It printed people and doors as well, and the three
// are different numbers in this feature — a block of flats is one stop, many
// doors, more people — so a card carrying all of them asked a candidate
// comparing two turfs to hold three ratios in their head. Stops is the one to
// keep: it is the router's own unit, it is what the 150 cap is stated in, and
// it is therefore the number that decides whether a turf can be bought at all.
//
// Printed bare rather than softened to "About N". Every other pre-route
// figure on this surface is softened because it is a superset of who gets
// knocked, and that is true of stops too — but the drawing surface prints
// this exact quantity two inches away as a bare "N selected", against a cap
// stated in the same unit, and one number rendered two ways is worse than an
// unhedged one.
// The noun is plain visible text rather than an `sr-only`/`aria-hidden`
// pair. That pair was worth it when the line carried three figures and only
// position told them apart; with one number "12 stops" reads the same to
// everyone, and splitting it across nodes only breaks the string up for no
// one's benefit.
export const DraftCounts = ({ stats }: DraftCountsProps) =>
  stats === null ? <>—</> : <>{stats.stops.toLocaleString()} stops</>
