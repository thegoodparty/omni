import {
  PRICE_PER_EMAIL_TENTH_CENTS,
  PRICE_PER_TEXT,
} from '@goodparty_org/contracts'
import { OUTREACH_OPTIONS, OUTREACH_TYPES } from '../constants'

export const centsLabel = (cents: number): string =>
  `${Number(cents.toFixed(1))}¢`

const unitPriceLabel = (dollars: number, unit: string): string =>
  `$${Number(dollars.toFixed(3))}/${unit}`

const robocallCost =
  OUTREACH_OPTIONS.find((o) => o.type === OUTREACH_TYPES.robocall)?.cost ?? 0

// Hub tile sub-copy, on the Win and Serve hubs alike.
export const TILE_PRICES = {
  free: 'Free',
  text: unitPriceLabel(PRICE_PER_TEXT, 'text'),
  robocall: unitPriceLabel(robocallCost, 'call'),
  email: unitPriceLabel(PRICE_PER_EMAIL_TENTH_CENTS / 1000, 'email'),
}
