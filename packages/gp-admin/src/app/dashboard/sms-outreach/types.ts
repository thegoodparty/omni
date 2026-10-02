import type {
  SmsApprovalStatus,
  SmsStandardsRule,
} from '@goodparty_org/contracts'

// Below this the header flags the vendor balance so ops refills before
// sends start running on credit. A starting point, not a tuned number:
// one busy send day can clear it.
export const LOW_BALANCE_WARNING_USD = 1000

export const STATUS_LABELS: Record<SmsApprovalStatus, string> = {
  awaiting_review: 'Awaiting review',
  denied: 'Denied',
  canvass_requested: 'Send booked',
  peerly_approved: 'Vendor approved',
  sent: 'Sent',
  canceled: 'Canceled',
}

export const STATUS_COLORS: Record<
  SmsApprovalStatus,
  'amber' | 'red' | 'blue' | 'green' | 'gray'
> = {
  awaiting_review: 'amber',
  denied: 'red',
  canvass_requested: 'blue',
  peerly_approved: 'green',
  sent: 'green',
  canceled: 'gray',
}

export const STANDARDS_RULE_LABELS: Record<SmsStandardsRule, string> = {
  opt_out_line: 'Missing "Reply STOP" opt-out line',
  first_name_token: 'Missing {first_name} personalization',
  candidate_name: "Message doesn't include the candidate's name",
  paid_for_by: 'Missing "Paid for by <committee>" disclaimer',
  length: 'Message exceeds the vendor length cap',
  link_shortener:
    'Contains a shortened link (e.g. bit.ly), which the vendor rejects',
}

export type QueueTab = 'awaiting' | 'booked' | 'sent' | 'denied' | 'canceled'

export const TAB_STATUSES: Record<QueueTab, SmsApprovalStatus[]> = {
  awaiting: ['awaiting_review'],
  booked: ['canvass_requested', 'peerly_approved'],
  sent: ['sent'],
  denied: ['denied'],
  canceled: ['canceled'],
}
