import type { VoterFileFilters } from '../shared/voterFileFilterTransform.util'

// `/dashboard/contacts?newList=<preset>` opens "Create new list" already
// filtered, so a surface can send someone straight to a list it has counted.
// Serve only, behind serve-citizen-panels: every preset is a civic panel one.
export const NEW_LIST_PARAM = 'newList'

export const NEW_LIST_PRESETS: Record<string, VoterFileFilters> = {
  // The panel home's "can be asked now": members outside the 30-day rest
  // window, the same rule that count uses.
  askableNow: { civicPanelMember: true, notContactedRecently: true },
}

export const newListHref = (preset: keyof typeof NEW_LIST_PRESETS): string =>
  `/dashboard/contacts?${NEW_LIST_PARAM}=${preset}`
