import { replyIntentAdapter } from './replyIntent.adapter'
import type { LabeledAdapter } from './types'

// Every labeled agent's adapter, keyed by agent id. A registry entry with
// shape `labeled` and no adapter here is skipped by name in the arm.
export const LABELED_ADAPTERS: Record<string, LabeledAdapter> = {
  reply_intent: replyIntentAdapter,
}
