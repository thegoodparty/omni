// The POC's rate, and what the walking estimate is worth: 45 doors an hour is
// a canvasser's sustained pace with the walk between doors included. Geoapify's
// own duration only exists once the route is built server-side, and building
// one is billed and irreversible — so every surface that has to answer "is this
// a reasonable evening?" before that quotes this instead. Lives here rather
// than in the draw step that first needed it because the details sheet answers
// the same question about a saved list, and two copies of the rate would drift.
export const DOORS_PER_HOUR = 45

// Callers name the rate alongside this, so it reads as a rule of thumb rather
// than a computed promise.
export const estimateWalkTime = (doors: number): string => {
  const minutes = Math.round((doors / DOORS_PER_HOUR) * 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

// The evening, for the two surfaces that state a duration with no room to
// qualify it: the walk's `N doors · {duration}` header and the details
// drawer's `Estimated time` metric. Both labels are the design's, and neither
// has a second line to say which half of the evening is on screen.
//
// It is a synthesis, and the alternative was worse. Geoapify's `totalSeconds`
// is travel alone, so printing it raw under either label undersold an evening
// by more than half; the drawer used to hedge that with a hint reading "travel
// between doors", which is a second label the design does not draw. The
// prototype makes the same synthesis (`mins` at design line 6421 is the
// route's travel plus two minutes a stop).
//
// The per-door allowance is `DOORS_PER_HOUR` and not the prototype's flat two
// minutes, because 45 doors an hour is the rate this product already publishes
// and quotes by name on the drawer — a second, unexplained pace would be a
// third number for the same thing. Geoapify's travel figure genuinely carries
// no time AT the doors (the jobs gp-api sends have no `duration`), so the two
// add rather than overlap.
export const estimateOutingSeconds = (
  travelSeconds: number,
  doors: number,
): number => travelSeconds + (doors / DOORS_PER_HOUR) * 3600
