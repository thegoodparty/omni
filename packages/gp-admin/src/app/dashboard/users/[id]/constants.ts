import { P2VStatus } from '@goodparty_org/sdk'

export const USER_ROUTES = {
  USER: '',
  CAMPAIGN: '/campaign',
  P2V: '/p2v',
  ELECTED_OFFICE: '/elected-office',
} as const

export const TAB_LABELS = {
  USER: 'User',
  CAMPAIGN: 'Campaigns',
  P2V: 'Paths to Victory',
  ELECTED_OFFICE: 'Elected Offices',
} as const

export const LAUNCH_STATUS = {
  LAUNCHED: 'launched',
  NOT_LAUNCHED: 'Not launched',
} as const

export const P2V_STATUS = Object.values(P2VStatus)

export const P2V_STATUS_SET: ReadonlySet<string> = new Set(P2V_STATUS)

export const P2V_STATUS_VALUES = {
  COMPLETE: P2VStatus.complete,
  WAITING: P2VStatus.waiting,
  FAILED: P2VStatus.failed,
  DISTRICT_MATCHED: P2VStatus.districtMatched,
} as const

export const OTHER_OFFICE = 'Other'
