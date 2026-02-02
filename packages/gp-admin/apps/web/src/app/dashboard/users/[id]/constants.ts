export const DETAIL_TABS = {
  USER: 'user',
  CAMPAIGN: 'campaign',
  P2V: 'p2v',
  ELECTED_OFFICE: 'elected-office',
  CONTENT: 'content',
  INTEGRATIONS: 'integrations',
} as const

export const DETAIL_TAB_VALUES = Object.values(DETAIL_TABS)
export type DetailTabValue = (typeof DETAIL_TAB_VALUES)[number]

export const EDIT_TABS = {
  USER: 'user',
  CAMPAIGN: 'campaign',
  P2V: 'p2v',
  ELECTED_OFFICE: 'elected-office',
} as const

export const EDIT_TAB_VALUES = Object.values(EDIT_TABS)
export type EditTabValue = (typeof EDIT_TAB_VALUES)[number]

export const LAUNCH_STATUS = {
  LAUNCHED: 'launched',
  NOT_LAUNCHED: 'Not launched',
} as const
