import {
  EMAIL_MIN_CHARGE_CENTS,
  PRICE_PER_EMAIL_TENTH_CENTS,
  PRICE_PER_TEXT,
} from '@goodparty_org/contracts'
import { OUTREACH_OPTIONS, OUTREACH_TYPES } from '../constants'

export const centsLabel = (cents: number): string =>
  `${Number(cents.toFixed(1))}¢`

const robocallCost =
  OUTREACH_OPTIONS.find((o) => o.type === OUTREACH_TYPES.robocall)?.cost ?? 0

const emailCents = PRICE_PER_EMAIL_TENTH_CENTS / 10

// Hub tile sub-copy, shown with the pricing flag on.
export const TILE_PRICES = {
  text: `${centsLabel(PRICE_PER_TEXT * 100)} a text`,
  robocall: `${centsLabel(robocallCost * 100)} a call`,
  email: `${centsLabel(emailCents)} each, ${Math.round(EMAIL_MIN_CHARGE_CENTS / emailCents)}-email minimum`,
}
