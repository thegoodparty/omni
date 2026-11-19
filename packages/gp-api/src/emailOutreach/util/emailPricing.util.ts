import {
  EMAIL_MIN_CHARGE_CENTS,
  PRICE_PER_EMAIL_TENTH_CENTS,
} from '@goodparty_org/contracts'
import { EMAIL_WARMING_STEPS } from '../emailOutreach.const'

export const warmingCapFor = (step: number): number => {
  const index = Math.min(Math.max(step, 0), EMAIL_WARMING_STEPS.length - 1)
  return EMAIL_WARMING_STEPS[index] ?? 0
}

export const nextWarmingStep = (step: number): number =>
  Math.min(step + 1, EMAIL_WARMING_STEPS.length - 1)

// The warming step's cap, less what the sender's other unfinished sends
// already reserved, and never more than this send's recipients.
export const recipientCapFor = ({
  warmingStep,
  reservedByOtherSends,
  recipientCount,
}: {
  warmingStep: number
  reservedByOtherSends: number
  recipientCount: number
}): number =>
  Math.max(
    0,
    Math.min(warmingCapFor(warmingStep) - reservedByOtherSends, recipientCount),
  )

export const emailPriceCents = (emails: number): number =>
  Math.max(
    EMAIL_MIN_CHARGE_CENTS,
    Math.ceil((emails * PRICE_PER_EMAIL_TENTH_CENTS) / 10),
  )

// What settle captures. A send that sent nothing owes nothing, so its hold
// is voided rather than charged the minimum.
export const emailChargeCents = (sentCount: number): number =>
  sentCount === 0 ? 0 : emailPriceCents(sentCount)
