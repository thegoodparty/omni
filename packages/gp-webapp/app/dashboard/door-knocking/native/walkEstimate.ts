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
