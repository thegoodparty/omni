const DEFAULT_PAGE_SIZE = 20

const PAGE_SIZES = [10, 20, 50, 100]

const SHEET_MODES = {
  CREATE: 'create',
  EDIT: 'edit',
} as const

const ALL_SEGMENTS = 'all'

// Error code returned by gp-api when a campaign can't resolve a district (or
// fails the federal/state download-access rule). The webapp maps it to a clean
// empty/ineligible state rather than surfacing the 4xx as an error. Mirrors
// VOTER_DATA_UNAVAILABLE_ERROR_CODE in gp-api's contacts.types.ts.
const VOTER_DATA_UNAVAILABLE_ERROR_CODE = 'VOTER_DATA_UNAVAILABLE'

export {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  SHEET_MODES,
  ALL_SEGMENTS,
  VOTER_DATA_UNAVAILABLE_ERROR_CODE,
}
