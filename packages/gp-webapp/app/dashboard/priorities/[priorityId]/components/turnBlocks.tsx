'use client'

import type { ChatCard } from '@goodparty_org/contracts'
import type { ChatMessageSegment } from '../../../shared/agent-chat/chatClient'
import { InlineSegments } from '../../../shared/agent-chat/chatUI'
import {
  segmentsToLive,
  type LiveSegment,
} from '../../../shared/agent-chat/streaming'
import { ChatCardRenderer } from '../cards/ChatCardRenderer'
import { toChatCard } from '../data/cards'
import { segmentKey } from '../data/statusReplay'
import { STATUS_TOOL, type StepChange } from '../data/statusUpdates'
import { priorityToolLabel } from '../data/toolLabels'
import { StatusChangeMarker } from './StatusChangeMarker'

// The two things a turn can leave behind besides prose and tool pills.
export type TurnExtra =
  | { kind: 'card'; card: ChatCard }
  | { kind: 'status'; changes: StepChange[] }

// A live extra plus how much turn text preceded the tool call that produced
// it, so it lands at that seam once the text before it has typed out — and
// stays there as later text types out below.
export interface PositionedExtra {
  key: string
  extra: TurnExtra
  appearAfter: number
}

export type TurnBlock =
  | { kind: 'segments'; key: string; segments: LiveSegment[] }
  | { kind: 'extra'; key: string; extra: TurnExtra }

export const liveTurnBlocks = (
  visibleSegments: LiveSegment[],
  extras: PositionedExtra[],
  revealedTextLength: number,
): TurnBlock[] => {
  const shown = extras
    .filter((extra) => revealedTextLength >= extra.appearAfter)
    .sort((a, b) => a.appearAfter - b.appearAfter)
  const blocks: TurnBlock[] = []
  let run: LiveSegment[] = []
  let acc = 0
  let next = 0

  const flushRun = (): void => {
    if (run.length > 0) {
      blocks.push({
        kind: 'segments',
        key: `seg-${blocks.length}`,
        segments: run,
      })
      run = []
    }
  }
  const placeUpTo = (pos: number): void => {
    for (let e = shown[next]; e && e.appearAfter <= pos; e = shown[next]) {
      flushRun()
      blocks.push({ kind: 'extra', key: e.key, extra: e.extra })
      next++
    }
  }

  for (const segment of visibleSegments) {
    if (segment.kind !== 'text') {
      // The pill goes in before anything placed at the same text position, so
      // a card that follows research renders below its pill, not above it.
      run.push(segment)
      placeUpTo(acc)
      continue
    }
    // Text deltas coalesce across a consumed tool call, so an extra's seam can
    // fall inside a single text segment; split it there.
    let text = segment.text
    let start = acc
    for (
      let e = shown[next];
      e && e.appearAfter <= start + text.length;
      e = shown[next]
    ) {
      const at = Math.max(e.appearAfter, start)
      const before = text.slice(0, at - start)
      if (before) run.push({ kind: 'text', text: before })
      flushRun()
      blocks.push({ kind: 'extra', key: e.key, extra: e.extra })
      text = text.slice(at - start)
      start = at
      next++
    }
    if (text) run.push({ kind: 'text', text })
    acc += segment.text.length
  }
  placeUpTo(acc)
  flushRun()
  return blocks
}

/**
 * A reloaded turn. The persisted segments already sit at their stream
 * positions, so walking them in order reproduces the live interleaving: prose
 * and ordinary tools into inline runs, card tools and status moves as their
 * own blocks.
 */
export const persistedTurnBlocks = ({
  messageId,
  segments,
  content,
  conversationId,
  markers,
}: {
  messageId: string
  segments: ChatMessageSegment[]
  content: string
  conversationId: string
  markers: Map<string, StepChange[]>
}): TurnBlock[] => {
  if (segments.length === 0) {
    const live = segmentsToLive([], content)
    return live.length > 0
      ? [{ kind: 'segments', key: `${messageId}-seg-0`, segments: live }]
      : []
  }
  const blocks: TurnBlock[] = []
  let run: ChatMessageSegment[] = []
  const flushRun = (): void => {
    const live = segmentsToLive(run, '')
    if (live.length > 0) {
      blocks.push({
        kind: 'segments',
        key: `${messageId}-seg-${blocks.length}`,
        segments: live,
      })
    }
    run = []
  }

  segments.forEach((segment, index) => {
    if (segment.kind !== 'tool' || !segment.toolName) {
      run.push(segment)
      return
    }
    if (segment.toolName === STATUS_TOOL) {
      const changes = markers.get(segmentKey(messageId, index))
      if (changes && changes.length > 0) {
        flushRun()
        blocks.push({
          kind: 'extra',
          key: `${messageId}-status-${index}`,
          extra: { kind: 'status', changes },
        })
      }
      return
    }
    const card = toChatCard({
      toolName: segment.toolName,
      args: segment.payload,
      toolCallId: segment.toolCallId,
      conversationId,
    })
    if (card) {
      flushRun()
      blocks.push({
        kind: 'extra',
        key: `${messageId}-card-${index}`,
        extra: { kind: 'card', card },
      })
      return
    }
    run.push(segment)
  })
  flushRun()
  return blocks
}

export const TurnBlocks = ({
  blocks,
  priorityId,
  conversationId,
}: {
  blocks: TurnBlock[]
  priorityId: string
  conversationId: string
}): React.JSX.Element => (
  <>
    {blocks.map((block) => {
      if (block.kind === 'segments') {
        return (
          <InlineSegments
            key={block.key}
            segments={block.segments}
            toolLabel={priorityToolLabel}
          />
        )
      }
      if (block.extra.kind === 'card') {
        return (
          <ChatCardRenderer
            key={block.key}
            card={block.extra.card}
            priorityId={priorityId}
            conversationId={conversationId}
          />
        )
      }
      return (
        <StatusChangeMarker key={block.key} changes={block.extra.changes} />
      )
    })}
  </>
)
