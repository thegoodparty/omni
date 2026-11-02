import { describe, expect, it } from 'vitest'
import {
  emptyPriorityStatus,
  type PriorityStatus,
} from '@goodparty_org/contracts'
import type {
  ChatMessageDto,
  ChatMessageSegment,
} from '../../../shared/agent-chat/chatClient'
import { replayStatusMarkers, segmentKey } from './statusReplay'
import {
  STATUS_TOOL,
  applyStatusUpdate,
  describeStepChange,
  parseStatusToolResult,
  statusChanges,
  type PriorityStatusUpdate,
} from './statusUpdates'

const turn = (id: string, segments: ChatMessageSegment[]): ChatMessageDto => ({
  id,
  conversationId: 'conv-1',
  role: 'assistant',
  content: '',
  createdAt: '2026-10-22T15:40:00.000Z',
  segments,
})

const statusCall = (
  toolCallId: string,
  payload: PriorityStatusUpdate | null,
): ChatMessageSegment => ({
  kind: 'tool',
  toolName: STATUS_TOOL,
  toolCallId,
  payload,
})

const settleTwo: PriorityStatusUpdate = {
  steps: [
    { id: 'define', state: 'settled', summary: 'Rents' },
    { id: 'evidence', state: 'settled', summary: 'Up 30%' },
    { id: 'listen_problem', state: 'settled', summary: 'Heard' },
  ],
  nextAction: 'Draft options',
}

const openOptions: PriorityStatusUpdate = {
  steps: [{ id: 'options', state: 'active' }],
  nextAction: 'Draft options',
}

describe('replayStatusMarkers', () => {
  it('draws nothing for a refused call, whose args the server dropped', () => {
    const markers = replayStatusMarkers([
      turn('a1', [statusCall('tc-1', settleTwo)]),
      turn('a2', [
        { kind: 'text', text: 'The plan waits on what residents say.' },
        statusCall('tc-2', null),
      ]),
    ])

    expect(markers.has(segmentKey('a2', 1))).toBe(false)
    expect(markers.get(segmentKey('a1', 0))?.map(describeStepChange)).toEqual([
      'Done with the problem',
      'Done with what we know',
      'Done with who to hear from',
    ])
  })

  it('measures a later move from what was stored, not from a refused ask', () => {
    const markers = replayStatusMarkers([
      turn('a1', [statusCall('tc-1', settleTwo)]),
      turn('a2', [statusCall('tc-2', null), statusCall('tc-3', openOptions)]),
    ])

    // Had the refused ask counted, options would already be settled here and
    // this would read as going back.
    expect(markers.get(segmentKey('a2', 1))?.map(describeStepChange)).toEqual([
      'Working on your options',
    ])
  })

  it('reloads with the same markers the live turn drew from its results', () => {
    // Live: each call's tool result is the stored status (the server's merge,
    // stood in for by the same merge here), or `{ error }` when refused, and
    // the marker is what moved since the last stored status.
    let stored: PriorityStatus = emptyPriorityStatus()
    const live: string[][] = []
    const results = [
      { status: applyStatusUpdate(stored, settleTwo).status },
      { error: 'Nothing was recorded. These did not move: The plan.' },
    ]
    for (const result of results) {
      const settled = parseStatusToolResult(result)
      if (!settled) continue
      live.push(statusChanges(stored, settled.status).map(describeStepChange))
      stored = settled.status
    }
    const third = applyStatusUpdate(stored, openOptions).status
    live.push(statusChanges(stored, third).map(describeStepChange))

    // Reload: what gp-api persisted for the same three calls.
    const markers = replayStatusMarkers([
      turn('a1', [statusCall('tc-1', settleTwo)]),
      turn('a2', [statusCall('tc-2', null)]),
      turn('a3', [statusCall('tc-3', openOptions)]),
    ])

    expect([...markers.values()].map((m) => m.map(describeStepChange))).toEqual(
      live,
    )
    expect(markers.size).toBe(2)
  })
})
