import {
  addMinutes,
  compareAsc,
  isAfter,
  isBefore,
  max,
  min,
  parseISO,
} from 'date-fns'
import { ChatMessageRole } from '@/generated/prisma'
import type { NewMarker } from '../schemas/caseScoutBucket.schema'

// The reader's field contract (Implementation Notes 2.1). No email, phone or
// user id: the staff flag and the denylist are computed in the query layer.
export type ToolCall = { tool: string | null; input: string | null }

export type Message = {
  conversationId: string
  scope: string
  messageId: string
  role: ChatMessageRole
  content: string
  createdAt: Date
  toolCalls: ToolCall[]
  isInternal: boolean
  denylist: string[]
}

export type Session = {
  sessionId: string
  conversationId: string
  scope: string
  startedAt: Date
  messages: Message[]
}

export const SESSION_GAP_MINUTES = 60
// Must equal the session gap: a window that starts any later could open in
// the middle of a session and read its tail as a new one.
export const QUERY_OVERLAP_MINUTES = SESSION_GAP_MINUTES

// Keyed off the session's first message rather than its position in tonight's
// read, which shifts once older sessions fall out of the window and would
// collide with an id already recorded as processed.
const sessionIdFor = (conversationId: string, first: Message): string =>
  `${conversationId}:${first.messageId}`

const toSession = (first: Message, messages: Message[]): Session => ({
  sessionId: sessionIdFor(first.conversationId, first),
  conversationId: first.conversationId,
  scope: first.scope,
  startedAt: first.createdAt,
  messages,
})

// Samuel's starts_session rule: only a conversation's first message, or a USER
// message more than 60 minutes after the one before it, opens a session. An
// assistant reply after a long gap stays in the session it answers.
export const segmentIntoSessions = (messages: Message[]): Session[] => {
  const byConversation = new Map<string, Message[]>()
  for (const message of messages) {
    const list = byConversation.get(message.conversationId) ?? []
    list.push(message)
    byConversation.set(message.conversationId, list)
  }

  const sessions: Session[] = []
  for (const conversationMessages of byConversation.values()) {
    const ordered = [...conversationMessages].sort((a, b) =>
      compareAsc(a.createdAt, b.createdAt),
    )
    let current: Message[] = []
    let previous: Message | undefined
    for (const message of ordered) {
      const startsNew =
        previous === undefined ||
        (message.role === ChatMessageRole.user &&
          isAfter(
            message.createdAt,
            addMinutes(previous.createdAt, SESSION_GAP_MINUTES),
          ))
      const [head] = current
      if (startsNew && head) {
        sessions.push(toSession(head, current))
        current = []
      }
      current.push(message)
      previous = message
    }
    const [head] = current
    if (head) sessions.push(toSession(head, current))
  }
  return sessions
}

export type SelectedSessions = {
  kept: Session[]
  excludedProcessedCount: number
  cappedCount: number
}

export const selectNewSessions = (
  sessions: Session[],
  processedSessionIds: string[],
  cap: number,
): SelectedSessions => {
  const processed = new Set(processedSessionIds)
  const fresh = sessions
    .filter((session) => !processed.has(session.sessionId))
    .sort((a, b) => compareAsc(a.startedAt, b.startedAt))
  const kept = fresh.slice(0, cap)
  return {
    kept,
    excludedProcessedCount: sessions.length - fresh.length,
    cappedCount: fresh.length - kept.length,
  }
}

type MarkerSession = { sessionId: string; startedAt: Date }

// The marker the draft job applies once tonight's handoff is held or sent.
// Ids older than one overlap window behind the new cutoff can never be read
// again, so they are dropped; while the old cutoff is still inside that
// window, every old id is carried forward, since a session it names can still
// be re-read.
export const newMarkerCandidate = (
  oldMarker: NewMarker,
  sessions: MarkerSession[],
): NewMarker => {
  if (sessions.length === 0) {
    return {
      lastSessionStart: oldMarker.lastSessionStart,
      processedSessionIds: [...oldMarker.processedSessionIds],
    }
  }
  const newLast = max(sessions.map((session) => session.startedAt))
  const cutoff = addMinutes(newLast, -QUERY_OVERLAP_MINUTES)
  const keptIds = sessions
    .filter((session) => !isBefore(session.startedAt, cutoff))
    .map((session) => session.sessionId)

  const oldLast = oldMarker.lastSessionStart
  const processedSessionIds =
    oldLast !== null && !isBefore(parseISO(oldLast), cutoff)
      ? [...new Set([...oldMarker.processedSessionIds, ...keptIds])]
      : keptIds

  return { lastSessionStart: newLast.toISOString(), processedSessionIds }
}

// A session the spend cap kept from being scored or drafted must stay
// readable on a later night. Drafting goes worst severity first, not oldest
// first, so skipping only the capped ids is not enough: the cutoff must also
// stay before the earliest capped session.
export const sessionsSafeToMarkProcessed = <T extends MarkerSession>(
  sessions: T[],
  cappedSessionIds: Set<string>,
): T[] => {
  const cappedStarts = sessions
    .filter((session) => cappedSessionIds.has(session.sessionId))
    .map((session) => session.startedAt)
  if (cappedStarts.length === 0) return sessions
  const earliest = min(cappedStarts)
  return sessions.filter(
    (session) =>
      !cappedSessionIds.has(session.sessionId) &&
      isBefore(session.startedAt, earliest),
  )
}
