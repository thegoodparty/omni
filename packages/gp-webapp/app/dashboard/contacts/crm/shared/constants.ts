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

// Shown when a list's rename/delete 409s because it was used for outreach
// (locked) — including the race where it gets locked between page load and
// the mutation. RenameListDialog, DeleteListDialog, and their tests all need
// this exact copy, so it lives here once (ENG-10707).
const LOCKED_LIST_MESSAGE =
  'This list was just used for outreach and is now locked — duplicate it to make changes.'

// ENG-10721/10725 (locked prototype parity): standalone rounded "pill" look
// for a ToggleGroupItem — 38px tall (px-16/py-8 in the Lovable spec),
// regular-weight label, selected = dark fill + white text
// (gp-webapp/CLAUDE.md's "-dark variant for selected/active state"
// convention; the prototype's near-black fill maps to tertiary-dark).
// Shared by VoterFileStep's filter/support-status pills and ActivityStep's
// channel/outcome toggles so the two surfaces can't drift on the same look.
const PILL_TOGGLE_ITEM_CLASSNAME =
  'rounded-full border border-components-input-border bg-transparent px-4 py-2 text-sm font-normal text-foreground data-[state=on]:border-tertiary-dark data-[state=on]:bg-tertiary-dark data-[state=on]:text-tertiary-foreground data-[state=on]:hover:bg-tertiary-dark/90'

// The Lovable filter-group label: 12px semibold sentence case, near-black.
const FILTER_GROUP_LABEL_CLASSNAME = 'text-xs font-semibold text-foreground'

export {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  SHEET_MODES,
  ALL_SEGMENTS,
  VOTER_DATA_UNAVAILABLE_ERROR_CODE,
  LOCKED_LIST_MESSAGE,
  PILL_TOGGLE_ITEM_CLASSNAME,
  FILTER_GROUP_LABEL_CLASSNAME,
}
