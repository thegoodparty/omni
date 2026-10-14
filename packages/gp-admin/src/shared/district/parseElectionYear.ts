/**
 * Extracts the election year from a campaign's `details.electionDate`.
 * Normally `YYYY-MM-DD`, but intake tooling (HubSpot) can store an epoch-ms
 * value such as `"1777680000000"`. Splitting that on `-` yields a
 * 13-digit "year" that matches no district, so the pickers list nothing.
 * Returns 0 when no plausible year can be read.
 */
export function parseElectionYear(
  electionDate: string | null | undefined
): number {
  if (!electionDate) return 0
  const trimmed = electionDate.trim()
  if (/^\d{10,13}$/.test(trimmed)) {
    const ms = trimmed.length === 10 ? Number(trimmed) * 1000 : Number(trimmed)
    const year = new Date(ms).getUTCFullYear()
    return Number.isFinite(year) ? year : 0
  }
  const year = Number(trimmed.split('-')[0])
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : 0
}
