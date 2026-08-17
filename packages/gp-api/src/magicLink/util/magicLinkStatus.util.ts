import { MagicLink, MagicLinkKind } from '../../generated/prisma'

/**
 * Derived lifecycle status of a magic link. Never stored — computed from the
 * record's timestamps + expiry so it can't drift, and so expiry "flips" the
 * status at read time without a write/cron.
 */
export type MagicLinkStatus =
  | 'sent'
  | 'redeemed'
  | 'onboarding_completed'
  | 'expired'

export function computeMagicLinkStatus(
  record: Pick<MagicLink, 'expiresAt' | 'redeemedAt' | 'onboardingCompletedAt'>,
  now: Date = new Date(),
): MagicLinkStatus {
  // Order matters: progress wins over expiry. A redeemed/onboarded link should
  // never read as "expired" just because its ticket TTL later lapsed.
  if (record.onboardingCompletedAt) return 'onboarding_completed'
  if (record.redeemedAt) return 'redeemed'
  if (record.expiresAt.getTime() < now.getTime()) return 'expired'
  return 'sent'
}

/**
 * HubSpot contact-property names the lifecycle is mirrored to. Serve (EO) and
 * Win (candidate) leads write to separate property sets so a person who is both
 * doesn't clobber one funnel with the other.
 *
 * NOTE: the redemption URL is deliberately NOT mirrored. It carries a live
 * single-use Clerk sign-in ticket (a bearer credential), and storing it in a
 * CRM property would put that credential at rest in HubSpot — readable by any
 * connected integration with contacts-read. The URL stays in gp-db only and is
 * served to the card on demand (see GET /admin/elected-office/magic-link).
 */
const PROPERTY_NAMES: Record<
  MagicLinkKind,
  {
    status: string
    sentAt: string
    expiresAt: string
    redeemedAt: string
    onboardingCompletedAt: string
  }
> = {
  SERVE: {
    status: 'eo_magic_link_status',
    sentAt: 'eo_magic_link_sent_at',
    expiresAt: 'eo_magic_link_expires_at',
    redeemedAt: 'eo_magic_link_redeemed_at',
    onboardingCompletedAt: 'eo_onboarding_completed_at',
  },
  WIN: {
    status: 'win_magic_link_status',
    sentAt: 'win_magic_link_sent_at',
    expiresAt: 'win_magic_link_expires_at',
    redeemedAt: 'win_magic_link_redeemed_at',
    onboardingCompletedAt: 'win_onboarding_completed_at',
  },
}

const toIso = (value: Date | null): string => (value ? value.toISOString() : '')

/**
 * Builds the HubSpot contact-property bag for a magic-link record — status +
 * timestamps only (never the URL; see PROPERTY_NAMES). Datetime properties are
 * sent as ISO strings (HubSpot accepts ISO-8601 for datetime props, matching
 * the existing `last_login` / `profile_updated_date` writes); cleared
 * transitions send '' so a regenerated link doesn't leave a stale
 * redeemed/completed timestamp on the contact.
 */
export function buildMagicLinkContactProperties(
  record: Pick<
    MagicLink,
    'kind' | 'sentAt' | 'expiresAt' | 'redeemedAt' | 'onboardingCompletedAt'
  >,
  now: Date = new Date(),
): Record<string, string> {
  const names = PROPERTY_NAMES[record.kind]
  return {
    [names.status]: computeMagicLinkStatus(record, now),
    [names.sentAt]: toIso(record.sentAt),
    [names.expiresAt]: toIso(record.expiresAt),
    [names.redeemedAt]: toIso(record.redeemedAt),
    [names.onboardingCompletedAt]: toIso(record.onboardingCompletedAt),
  }
}
