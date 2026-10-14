// Where the report's Back goes. The report is reached from several places
// (the outreach drawer, a phone list, a turf), so the link that opens it says
// where it was pressed, and Back returns there instead of always to the hub.
// Carried through to a theme's page, so its Back to the report keeps it.
export const RETURN_PARAM = 'from'

// Only a page of this dashboard, never another origin: the value is read
// straight off the URL.
export const safeReturnPath = (value: string | null): string | null =>
  value !== null && value.startsWith('/dashboard/') ? value : null

export const withReturnPath = (href: string, from: string | null): string =>
  from === null ? href : `${href}?${RETURN_PARAM}=${encodeURIComponent(from)}`
