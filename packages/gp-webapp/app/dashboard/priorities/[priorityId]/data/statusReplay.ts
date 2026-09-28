import {
  emptyPriorityStatus,
  type PriorityStatus,
} from '@goodparty_org/contracts'
import type { ChatMessageDto } from '../../../shared/agent-chat/chatClient'
import {
  STATUS_TOOL,
  applyStatusUpdate,
  parseStatusUpdate,
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
      const applied = applyStatusUpdate(status, update)
      status = applied.status
      if (applied.changes.length > 0) {
        markers.set(segmentKey(message.id, index), applied.changes)
      }
    })
  }
  return markers
}
