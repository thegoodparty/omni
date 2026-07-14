// FNV-1a 32-bit hash — deterministic, no Math.random.
const fnv1a32 = (str: string): number => {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    // Multiply by FNV prime (16777619) via bitwise, keep 32-bit unsigned
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Maps an org slug to a stable bucket in [0, mod). Deterministic: the same
 * slug always returns the same bucket, with no randomness.
 *
 * Used by crons to spread dispatches across days:
 *   trending — bucketForSlug(slug, 7) === today.getUTCDay()
 *   top      — bucketForSlug(slug, 28) === topIssuesBucketForDate(today)
 */
export const bucketForSlug = (slug: string, mod: number): number =>
  fnv1a32(slug) % mod

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Rolling 28-day bucket for the monthly top_community_issues rotation, in
 * [0, 28). Deliberately NOT calendar day-of-month: a prior version used
 * `Math.min(date.getUTCDate(), 28) - 1`, which ties the cycle to the
 * calendar month, so the 29th/30th/31st (days a 28-bucket cycle has no room
 * for) all collapsed onto bucket 27 — an org hashed there fired up to 4
 * times in a single 31-day month instead of once per ~28 days. Counting
 * whole UTC days since a fixed epoch instead makes every calendar day map to
 * exactly one bucket, rotating smoothly across month boundaries with no
 * repeats or gaps. Uses raw epoch-ms math rather than date-fns because
 * date-fns' calendar-day helpers resolve to the local system timezone;
 * dividing the UTC millisecond timestamp is unambiguous and matches the
 * explicit UTC intent of the sibling `getUTCDay()` weekly bucket above.
 */
export const topIssuesBucketForDate = (date: Date): number =>
  Math.floor(date.getTime() / MS_PER_DAY) % 28
