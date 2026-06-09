import type { Website } from 'helpers/types'

// Single source of truth for the website-discontinuation (sunset) notice.
// Both WebsiteSunsetModal (dashboard home) and WebsiteSunsetBanner (Settings)
// read from here so the HubSpot form URL and the enabled flag live in one place.
//
// Set to the real HubSpot domain-transfer form URL once the form is built in
// HubSpot (ENG-10295). While empty, WEBSITE_SUNSET_NOTICE_ENABLED is false and
// neither the modal nor the banner is shown. This avoids both linking to a
// non-existent form and opting users out of the notice before the form they
// need exists.
export const HUBSPOT_DOMAIN_TRANSFER_FORM_URL =
  'https://cuqn1.share.hsforms.com/24lFrnq6gQ6-FWs_7qUr5SQ'

export const WEBSITE_SUNSET_NOTICE_ENABLED =
  HUBSPOT_DOMAIN_TRANSFER_FORM_URL.length > 0

// The sunset notice targets candidates who purchased a domain through
// GoodParty, not anyone with a website row — auto-generated/hidden sites and
// brand-new accounts have a Website but no purchased domain (ENG-10343).
// `website.domain` is populated by GET /websites/mine only when a custom
// domain was purchased; null otherwise.
export const isWebsiteSunsetEligible = (website: Website | null): boolean =>
  WEBSITE_SUNSET_NOTICE_ENABLED && Boolean(website?.domain)
