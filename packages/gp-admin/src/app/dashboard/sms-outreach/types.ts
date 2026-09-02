import type {
  SmsApprovalStatus,
  SmsStandardsRule,
} from '@goodparty_org/contracts'

export const STATUS_LABELS: Record<SmsApprovalStatus, string> = {
  awaiting_review: 'Awaiting review',
  denied: 'Denied',
  canvass_requested: 'Send booked',
  peerly_approved: 'Vendor approved',
}

export const STATUS_COLORS: Record<
  SmsApprovalStatus,
  'amber' | 'red' | 'blue' | 'green'
> = {
  awaiting_review: 'amber',
  denied: 'red',
  canvass_requested: 'blue',
  peerly_approved: 'green',
}

export const STANDARDS_RULE_LABELS: Record<SmsStandardsRule, string> = {
  opt_out_line: 'Missing "Reply STOP" opt-out line',
  first_name_token: 'Missing {first_name} personalization',
  candidate_name: "Message doesn't include the candidate's name",
  paid_for_by: 'Missing "Paid for by <committee>" disclaimer',
  length: 'Message exceeds the vendor length cap',
}

export type QueueTab = 'awaiting' | 'booked' | 'denied'

export const TAB_STATUSES: Record<QueueTab, SmsApprovalStatus[]> = {
  awaiting: ['awaiting_review'],
  booked: ['canvass_requested', 'peerly_approved'],
  denied: ['denied'],
}
