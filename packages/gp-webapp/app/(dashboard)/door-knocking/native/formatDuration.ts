// Seconds as the design writes them: `45m`, `2h`, `2h 15m` — never `2h 0m`,
// which is what three separate copies of this function around the feature each
// produced on the hour. One copy, because the rail, the details drawer and the
// walk all print the SAME route's duration and reading two spellings of it
// across two surfaces is the same defect as reading two numbers.
//
// Rounded up rather than to nearest, matching the design: a walk quoted short
// is the mistake that costs an evening.
export const formatDuration = (seconds: number): string => {
  const minutes = Math.ceil(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  if (rest === 0) return `${hours}h`
  return `${hours}h ${rest}m`
}
