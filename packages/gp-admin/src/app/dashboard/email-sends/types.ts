import type { EmailPausedSend } from '@goodparty_org/contracts'

type OutreachEmailPauseReason = EmailPausedSend['pauseReason']

export const PAUSE_REASON_LABELS: Record<OutreachEmailPauseReason, string> = {
  bounce_rate: 'Bounce rate too high',
  complaint_rate: 'Complaint rate too high',
  ses_account: 'Amazon SES paused the account',
  ses_tenant: 'Amazon SES paused this sender',
  daily_quota: 'Daily sending limit reached',
  manual: 'Paused by staff',
}

export const formatRate = (rate: number): string =>
  `${(rate * 100).toFixed(2)}%`
