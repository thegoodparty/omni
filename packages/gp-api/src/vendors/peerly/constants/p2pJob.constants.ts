import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'

export const P2P_JOB_DEFAULTS = {
  CAMPAIGN_NAME: 'P2P SMS Campaign',
  DID_STATE: 'USA',
  TEMPLATE_TITLE: 'Default Template',
} as const

// Reading one job's state is a poll, not a write: the status sweep does it once
// per open outreach in sequence, and the admin console does it per row of its
// queue. Both want an answer or none, so the read gets a deadline of its own
// rather than inheriting PEERLY_HTTP_TIMEOUT (60s per attempt, up to four
// attempts, which is minutes of sweep time spent on one unresponsive job). 8s
// is an order of magnitude above the ~0.2-0.7s Peerly normally takes.
export const P2P_JOB_READ_TIMEOUT_MS = 8_000

export const P2P_ERROR_MESSAGES = {
  IMAGE_REQUIRED: 'Image file is required for P2P job creation',
  SCRIPT_TOO_LONG:
    'Script text exceeds the Peerly MMS template limit of ' +
    `${P2P_SCRIPT_MAX_LENGTH} characters`,
  INVALID_IMAGE_PROPERTIES: 'Invalid image file: missing required properties',
  JOB_CREATION_FAILED: 'Failed to create P2P job',
  JOB_UPDATE_FAILED: 'Failed to update P2P job',
  LIST_ASSIGNMENT_FAILED:
    'List assignment failed; job exists in Peerly and may require manual recovery',
  RETRIEVE_JOB_FAILED: 'Failed to fetch P2P job',
  DELETE_JOB_FAILED: 'Failed to delete P2P job',
  REQUEST_CANVASSERS_FAILED: 'Failed to request canvassers for P2P job',
  ACTIVATE_JOB_FAILED: 'Failed to activate P2P job',
  CLEAR_CANVASSERS_FAILED: 'Failed to clear canvasser request for P2P job',
  JOB_STATS_FAILED: 'Failed to fetch P2P job stats',
  RETRIEVE_JOBS_FAILED: 'Failed to fetch P2P jobs',
  LIST_TEST_JOBS_FAILED: 'Failed to fetch P2P test jobs',
} as const

export const P2P_PHONE_LIST_MAP = {
  first_name: 1,
  last_name: 2,
  lead_phone: 3,
  state: 4,
  city: 5,
  zip: 6,
} as const

export const P2P_SCHEDULE_DEFAULTS = {
  IS_GLOBAL: 1,
} as const

export const P2P_DNC_SCRUBBING = 0
export const P2P_DNC_SUPPRESS_INITIALS = 'GE' // GoodParty Engineering Peerly user
