import { APP_ROOT } from 'src/shared/util/appEnvironment.util'

/**
 * The texted entry point. Exists because the ticketed redemption URL runs to
 * ~743 characters (Clerk sign-in tokens are RS256 JWTs, so the signature alone
 * is 342), which is five SMS segments and a query string that reads as phishing
 * to carrier link filters. Resolved by GET /v1/magic-link/resolve/:slug behind
 * the webapp's /s/[slug] route.
 */
export const buildMagicLinkShortUrl = (slug: string): string =>
  `${APP_ROOT}/s/${slug}`

/**
 * Message body for a sales-sent magic link. Carries the brand name and STOP
 * language required by our registered 10DLC campaign, and is sized to stay in
 * one GSM-7 segment (see magicLinkSms.util.test.ts, which fails if an edit
 * pushes it over or introduces a non-GSM-7 character).
 *
 * Keep to straight ASCII punctuation. A curly apostrophe would switch the whole
 * message to UCS-2 and cut the budget from 160 characters to 70.
 */
export const buildMagicLinkSmsBody = (shortUrl: string): string =>
  `GoodParty: your sign-in link to finish setting up your account: ${shortUrl} Reply STOP to opt out.`

// GSM 03.38 basic character set. Anything outside this (plus the extension set
// below) forces the message into UCS-2.
const GSM7_BASE = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
)

// Extension-set characters are encodable in GSM-7 but cost two septets each.
const GSM7_EXTENDED = new Set('^{}\\[~]|€')

export const isGsm7 = (text: string): boolean =>
  [...text].every((char) => GSM7_BASE.has(char) || GSM7_EXTENDED.has(char))

/**
 * Septet cost of a GSM-7 string, counting extension-set characters twice.
 * Returns null when the text is not GSM-7 encodable at all.
 */
export const gsm7Septets = (text: string): number | null => {
  let septets = 0
  for (const char of text) {
    if (GSM7_BASE.has(char)) septets += 1
    else if (GSM7_EXTENDED.has(char)) septets += 2
    else return null
  }
  return septets
}

/**
 * SMS segments a GSM-7 message occupies. A single message fits 160 septets, but
 * concatenated messages spend 7 septets per part on the UDH header, leaving 153.
 */
export const gsm7SegmentCount = (text: string): number | null => {
  const septets = gsm7Septets(text)
  if (septets === null) return null
  if (septets <= 160) return 1
  return Math.ceil(septets / 153)
}
