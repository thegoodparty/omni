import { Prisma } from '@/generated/prisma'

// The saved-list columns contracts' isCivicPanelOnlyList reads, for the
// door, call and text paths that decide from a list's criteria whether it
// can only hold civic panel members.
export const CIVIC_PANEL_ONLY_SELECT = {
  civicPanelMember: true,
  civicPanelLeft: true,
  civicPanelNeverInvited: true,
  civicPanelJoinedByText: true,
  civicPanelJoinedByDoor: true,
  civicPanelJoinedByPhone: true,
  civicPanelJoinedByHand: true,
  civicPanelJoinedFrom: true,
  civicPanelJoinedTo: true,
} as const satisfies Prisma.VoterFileFilterSelect
