import { DoorKnockingMode } from '@goodparty_org/contracts'

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

// What the other mode would have taken over the path we actually bought. The
// route row is never rewritten and the stored pathGeometry is the bought mode's
// alone, so this converts a fixed distance at a different speed rather than
// implying a second route exists.
export const estimateTravelSeconds = (
  totalMeters: number,
  mode: DoorKnockingMode,
): number => Math.round(totalMeters / METERS_PER_SECOND[mode])
