import type {
  CivicPanelBalanceStatus,
  ReadRepresentativeness,
} from '@goodparty_org/contracts'

// A priority's read status, as the `readStatus` analytics property spells it.
export const READ_STATUS_PROPERTY: Record<ReadRepresentativeness, string> = {
  tooEarly: 'waiting_on_groups',
  notYetRepresentative: 'groups_need_answers',
  gettingClose: 'groups_unsure',
  representative: 'every_group_heard',
  enoughAnswers: 'enough_answers',
}

// The civic panel's status, as its analytics property spells it.
export const PANEL_STATUS_PROPERTY: Record<CivicPanelBalanceStatus, string> = {
  tooFewMembers: 'too_few_members',
  missingGroups: 'missing_groups',
  everyGroup: 'every_group',
}
