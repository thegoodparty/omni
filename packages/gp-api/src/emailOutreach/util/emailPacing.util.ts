import {
  SEND_BATCH_SIZE,
  SEND_RATE_HEADROOM,
  SEND_TICK_BUDGET_MS,
} from '../emailOutreach.const'

// Whole batches a tick may send so its rate stays at or under the headroom
// share of MaxSendRate over the full budget. Rounds down, never up; one batch
// at least so a very low rate still makes progress.
export const batchesPerTick = (
  maxSendRate: number,
  budgetMs: number = SEND_TICK_BUDGET_MS,
): number =>
  Math.max(
    1,
    Math.floor(
      (maxSendRate * SEND_RATE_HEADROOM * (budgetMs / 1000)) / SEND_BATCH_SIZE,
    ),
  )
