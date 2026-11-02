// Whether a saved list can only ever hold current civic panel members, read
// off its criteria alone. Outreach to such a list is outreach to the panel:
// a text never asks them to join, and a door or call asks whether they
// want to stay on rather than whether they want to join.
//
// Mirrors how gp-api resolves the panel filters (ContactsService
// .resolveCivicPanelMember). The status group ORs member, left and never
// invited, so member alone is panel-only and member with either other option
// is not. The joined group (how and when they joined) matches current
// members only and ANDs onto the status group, so any joined criterion is
// panel-only whatever the status group says. Every other criterion only
// narrows. A sample that mixes panel members with fresh residents is drawn
// within criteria that do not ask for membership, so it is never panel-only.

// Loose on purpose: the webapp's saved-list shape types every criterion as
// unknown, gp-api's row as boolean or string or null, and a chat proposal's
// audience filters as a plain record. Only the civic panel keys are read.
export type CivicPanelOnlyCriteria = Readonly<Record<string, unknown>>

const isDay = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0

export const isCivicPanelOnlyList = (list: CivicPanelOnlyCriteria): boolean => {
  const joined =
    list.civicPanelJoinedByText === true ||
    list.civicPanelJoinedByDoor === true ||
    list.civicPanelJoinedByPhone === true ||
    list.civicPanelJoinedByHand === true ||
    isDay(list.civicPanelJoinedFrom) ||
    isDay(list.civicPanelJoinedTo)
  if (joined) return true
  return (
    list.civicPanelMember === true &&
    list.civicPanelLeft !== true &&
    list.civicPanelNeverInvited !== true
  )
}
