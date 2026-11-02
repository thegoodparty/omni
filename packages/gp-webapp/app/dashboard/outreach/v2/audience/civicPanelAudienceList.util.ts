import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import { CIVIC_PANEL_FILTER_KEY } from 'app/dashboard/contacts/crm/shared/recommendedListFilters.config'
import { isCriteriaFreeList } from './universeList.util'

export const CIVIC_PANEL_AUDIENCE_NAME = 'Your civic panel'

// The saved list this card creates: our name, and `civicPanelMember` as its
// only criterion. That list is panel-only (contracts' isCivicPanelOnlyList),
// so every channel's existing members-only handling applies to it. Name and
// criteria both, for the reasons `isUniverseList` gives.
export const isCivicPanelAudienceList = (list: SegmentResponse): boolean =>
  list.name === CIVIC_PANEL_AUDIENCE_NAME &&
  list[CIVIC_PANEL_FILTER_KEY] === true &&
  !list.civicPanelJoinedFrom &&
  !list.civicPanelJoinedTo &&
  isCriteriaFreeList({ ...list, [CIVIC_PANEL_FILTER_KEY]: false })
