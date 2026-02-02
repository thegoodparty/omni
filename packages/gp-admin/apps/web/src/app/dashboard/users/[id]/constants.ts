export const TABS = {
  USER: 'user',
  CAMPAIGN: 'campaign',
  P2V: 'p2v',
  ELECTED_OFFICE: 'elected-office',
  CONTENT: 'content',
  INTEGRATIONS: 'integrations',
} as const

export const TAB_VALUES = Object.values(TABS)
export type TabValue = (typeof TAB_VALUES)[number]

export const EDIT_TAB_VALUES = [
  TABS.USER,
  TABS.CAMPAIGN,
  TABS.P2V,
  TABS.ELECTED_OFFICE,
] as const
export type EditTabValue = (typeof EDIT_TAB_VALUES)[number]

export const LAUNCH_STATUS = {
  LAUNCHED: 'launched',
  NOT_LAUNCHED: 'Not launched',
} as const

export const P2V_STATUS_VALUES = {
  WAITING: 'Waiting',
  PROCESSING: 'Processing',
  COMPLETE: 'Complete',
  FAILED: 'Failed',
  NOT_NEEDED: 'Not Needed',
} as const
