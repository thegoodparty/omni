import {
  emptyPriorityStatus,
  type PriorityStatus,
} from '@goodparty_org/contracts'
import type { ChatMessageDto } from '../../../shared/agent-chat/chatClient'
import {
  STATUS_TOOL,
  applyStatusUpdate,
  parseStatusUpdate,
  statusChanges,
  type StepChange,
} from './statusUpdates'

export const segmentKey = (messageId: string, index: number): string =>
  `${messageId}:${index}`

/**
 * Replay every status tool call in the transcript, from an empty status, so a
 * reloaded conversation carries the same markers it carried live. A stored
 * patch says what a step became but not what it was, and "backwards" is the
 * whole point of the marker — so the prior state has to be rebuilt rather than
 * read.
 *
 * The transcript keeps a call's args, not its result. It replays the result
 * anyway: gp-api nulls the args of a refused call (`isToolRefusal`), so every
 * call left with args is one the server applied, through the same merge as
 * `applyStatusUpdate`. Transcripts saved before that nulling (October 2026)
 * can still replay a refused move.
 */
export const replayStatusMarkers = (
  messages: ChatMessageDto[],
): Map<string, StepChange[]> => {
  let status: PriorityStatus = emptyPriorityStatus()
  const markers = new Map<string, StepChange[]>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    ;(message.segments ?? []).forEach((segment, index) => {
      if (segment.kind !== 'tool' || segment.toolName !== STATUS_TOOL) return
      const update = parseStatusUpdate(segment.payload)
      if (!update) return
      const next = applyStatusUpdate(status, update).status
      const changes = statusChanges(status, next)
      status = next
      if (changes.length > 0) {
        markers.set(segmentKey(message.id, index), changes)
      }
    })
  }
  return markers
}
