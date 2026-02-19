export const USER_ROUTES = {
  USER: '',
  CAMPAIGN: '/campaign',
  P2V: '/p2v',
  ELECTED_OFFICE: '/elected-office',
} as const

export const TAB_LABELS = {
  USER: 'User',
  CAMPAIGN: 'Campaign',
  P2V: 'Path to Victory',
  ELECTED_OFFICE: 'Elected Office',
} as const

export const LAUNCH_STATUS = {
  LAUNCHED: 'launched',
  NOT_LAUNCHED: 'Not launched',
} as const

export const P2V_STATUS = [
  'Waiting',
  'Processing',
  'Complete',
  'Failed',
  'Not Needed',
] as const

export type P2VStatus = (typeof P2V_STATUS)[number]

export const CAMPAIGN_PLAN_STATUS = {
  COMPLETED: 'completed',
  FAILED: 'failed',
  PENDING: 'pending',
} as const

export const P2V_STATUS_VALUES = {
  WAITING: 'Waiting',
  PROCESSING: 'Processing',
  COMPLETE: 'Complete',
  FAILED: 'Failed',
  NOT_NEEDED: 'Not Needed',
} as const satisfies Record<string, P2VStatus>
