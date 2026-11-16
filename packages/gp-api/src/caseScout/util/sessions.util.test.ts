import { addMinutes, parseISO } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { ChatMessageRole } from '@/generated/prisma'
import {
  newMarkerCandidate,
  segmentIntoSessions,
  selectNewSessions,
  sessionsSafeToMarkProcessed,
  type Message,
} from './sessions.util'

const START = parseISO('2026-11-15T10:00:00.000Z')

const message = (
  conversationId: string,
  messageId: string,
  minutes: number,
  role: ChatMessageRole = ChatMessageRole.user,
): Message => ({
  conversationId,
  scope: 'chief_of_staff',
  messageId,
  role,
  content: 'text',
  createdAt: addMinutes(START, minutes),
  toolCalls: [],
  isInternal: false,
  denylist: [],
})

const ids = (messages: Message[]) =>
  segmentIntoSessions(messages).map((s) => s.sessionId)

describe('segmentIntoSessions', () => {
  it('keeps messages within sixty minutes in one session', () => {
    expect(ids([message('c', 'm1', 0), message('c', 'm2', 60)])).toEqual([
      'c:m1',
    ])
  })

  it('splits before a user message more than sixty minutes later', () => {
    expect(ids([message('c', 'm1', 0), message('c', 'm2', 61)])).toEqual([
      'c:m1',
      'c:m2',
    ])
  })

  it('never splits on an assistant message', () => {
    expect(
      ids([
        message('c', 'm1', 0),
        message('c', 'm2', 120, ChatMessageRole.assistant),
      ]),
    ).toEqual(['c:m1'])
  })

  it('segments conversations independently', () => {
    expect(ids([message('a', 'm1', 0), message('b', 'm2', 5)])).toEqual([
      'a:m1',
      'b:m2',
    ])
  })
})

describe('selectNewSessions', () => {
  const sessions = segmentIntoSessions([
    message('c', 'late', 300),
    message('b', 'mid', 100),
    message('a', 'early', 0),
  ])

  it('drops processed ids, keeps the oldest first and caps the rest', () => {
    expect(selectNewSessions(sessions, ['b:mid'], 1)).toMatchObject({
      kept: [{ sessionId: 'a:early' }],
      excludedProcessedCount: 1,
      cappedCount: 1,
    })
  })
})

describe('newMarkerCandidate', () => {
  const at = (minutes: number) => addMinutes(START, minutes)
  const empty = { lastSessionStart: null, processedSessionIds: [] }

  it('leaves the marker alone when nothing new was read', () => {
    const old = { lastSessionStart: 'x', processedSessionIds: ['a'] }
    expect(newMarkerCandidate(old, [])).toEqual(old)
  })

  it('moves to the latest session and keeps one overlap window of ids', () => {
    expect(
      newMarkerCandidate(empty, [
        { sessionId: 'old', startedAt: at(0) },
        { sessionId: 'edge', startedAt: at(60) },
        { sessionId: 'new', startedAt: at(120) },
      ]),
    ).toEqual({
      lastSessionStart: at(120).toISOString(),
      processedSessionIds: ['edge', 'new'],
    })
  })

  it('drops old ids once the old cutoff leaves the overlap window', () => {
    expect(
      newMarkerCandidate(
        {
          lastSessionStart: at(0).toISOString(),
          processedSessionIds: ['gone'],
        },
        [{ sessionId: 'new', startedAt: at(120) }],
      ).processedSessionIds,
    ).toEqual(['new'])
  })
})

describe('sessionsSafeToMarkProcessed', () => {
  it('holds before the earliest capped session, not just its id', () => {
    const at = (minutes: number) => addMinutes(START, minutes)
    const sessions = [
      { sessionId: 'a', startedAt: at(0) },
      { sessionId: 'capped', startedAt: at(10) },
      { sessionId: 'b', startedAt: at(20) },
    ]
    expect(
      sessionsSafeToMarkProcessed(sessions, new Set(['capped'])).map(
        (s) => s.sessionId,
      ),
    ).toEqual(['a'])
  })
})
