import {
  MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE,
  MANAGED_CIVIC_PANEL_SET_UP_MESSAGE,
} from '@goodparty_org/contracts'

// The hidden turns waiting to be sent, after the civic panel invite closes.
// The agent hears one turn per close at most: a queued set up wins, a set up
// replaces a queued back out, and a second back out is dropped, so closing
// twice or closing then approving never sends both.
export const queueManagedPanelTurn = (
  queue: string[],
  setUp: boolean,
): string[] => {
  if (queue.includes(MANAGED_CIVIC_PANEL_SET_UP_MESSAGE)) return queue
  if (setUp) {
    return [
      ...queue.filter(
        (turn) => turn !== MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE,
      ),
      MANAGED_CIVIC_PANEL_SET_UP_MESSAGE,
    ]
  }
  return queue.includes(MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE)
    ? queue
    : [...queue, MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE]
}
