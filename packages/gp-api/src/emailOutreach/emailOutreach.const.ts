import { IS_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'

export const EMAIL_OUTREACH_DOMAIN = IS_PROD_DEPLOY
  ? 'outreachmail.goodparty.org'
  : 'outreachmail-dev.goodparty.org'

// gp-api's public origin, for the one-click unsubscribe link in each email's
// List-Unsubscribe header. Previews send through the vendor mock.
export const EMAIL_API_ROOT = IS_PROD_DEPLOY
  ? 'https://gp-api.goodparty.org'
  : 'https://gp-api-dev.goodparty.org'

export const EMAIL_NAME_MAX_LENGTH = 100
export const EMAIL_ADDRESS_MAX_LENGTH = 254
export const FORWARD_CONFIRM_TTL_HOURS = 24
export const EMAIL_UPLOAD_MAX_BYTES = 2_000_000

// Per-sender warming caps, stepped up only after a clean send.
export const EMAIL_WARMING_STEPS = [1_000, 5_000, 25_000, 100_000, 250_000]
export const WARMING_ADVANCE_MAX_BOUNCE_RATE = 0.02
export const WARMING_ADVANCE_MAX_COMPLAINT_RATE = 0.0005

// Below SES's account review line (5% and 0.1%), so no mix of sends can
// average above it.
export const AUTO_PAUSE_MIN_SENDS = 500
export const AUTO_PAUSE_MAX_BOUNCE_RATE = 0.04
export const AUTO_PAUSE_MAX_COMPLAINT_RATE = 0.0008
export const AUTO_PAUSE_CHECK_MINUTES = 5

export const SEND_BATCH_SIZE = 50
export const SEND_TICK_BUDGET_MS = 50_000
export const SEND_LEASE_SECONDS = 90
export const STUCK_SENDING_MINUTES = 5
export const ACCOUNT_CACHE_SECONDS = 60
export const SEND_RATE_HEADROOM = 0.9
export const DAILY_QUOTA_HEADROOM = 0.9
export const PREPARE_RETRY_MINUTES = 10
export const PREPARE_GIVE_UP_HOURS = 6

// Dev calls real SES, so it may reach only the team and the SES mailbox
// simulator.
export const DEV_ALLOWED_EMAIL_DOMAINS = [
  'goodparty.org',
  'simulator.amazonses.com',
]
