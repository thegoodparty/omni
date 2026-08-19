import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import type { OutreachType } from 'gpApi/outreach.api'

const VALID_OUTREACH_TYPES: readonly string[] = [
  OUTREACH_TYPES.text,
  OUTREACH_TYPES.doorKnocking,
  OUTREACH_TYPES.phoneBanking,
  OUTREACH_TYPES.socialMedia,
  OUTREACH_TYPES.robocall,
  OUTREACH_TYPES.p2p,
]

/**
 * Type guard to check if a value is a valid OutreachType.
 * Useful for runtime validation when converting from broader types (e.g., TASK_TYPES).
 *
 * @param value - The value to check
 * @returns True if the value is a valid OutreachType
 */
export const isValidOutreachType = (value: string): value is OutreachType => {
  return VALID_OUTREACH_TYPES.includes(value)
}

/**
 * Normalizes an outreach type for API payloads: 'text' is always sent as
 * 'p2p' (the P2P UX is the only text experience).
 */
export const getEffectiveOutreachType = (type: OutreachType): OutreachType => {
  if (type === OUTREACH_TYPES.text) {
    return OUTREACH_TYPES.p2p
  }
  return type
}
