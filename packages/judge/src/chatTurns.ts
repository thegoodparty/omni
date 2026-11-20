import type { ChatAnchor } from '@goodparty_org/contracts'
import { excerpt } from './annotation'
import type { EvalContext } from './suite'

// Driving a chat agent through the routes the webapp itself uses. A chat has no
// run route: the turn streams, and the reply is the SSE body, so the arm posts
// each turn to the conversation it opened as the case's own test user.
//
//   POST /v1/chats                     { scope, anchor? } -> { conversationId }
//   POST /v1/chats/:id/messages?scope= { content }        -> text/event-stream
//
// briefing_annotation is the exception: its conversation is created together
// with the annotation it hangs off, so it opens on its own pair of routes.
//
//   POST /v1/briefing-chats              { meetingDate, anchor }
//   POST /v1/briefing-chats/:annotationId/messages
//
// The org header is already on the arm's client (`arm.ts`), so every path here
// is relative to the arm's API root and scoped to the org bootstrap created.

// The four scopes POST /v1/chats accepts. briefing_annotation is absent on
// purpose: that scope's handler refuses a conversation opened without its
// annotation, and `briefingChatTurns` is how one is opened.
export type ChatScope =
  | 'chief_of_staff'
  | 'campaign_assistant'
  | 'ordinance_flow'
  | 'priority_flow'

export type BriefingChatAnchor = {
  jsonPath: string | null
  start: number | null
  end: number | null
}

export type ChatTurnsInput = {
  scope: ChatScope
  turns: readonly string[]
  // ordinance_flow and priority_flow refuse a conversation with no anchor: the
  // thread is keyed to the ordinance step or the priority it works on.
  anchor?: ChatAnchor
}

export type BriefingChatTurnsInput = {
  meetingDate: string
  // All null opens on the whole briefing; a set pointer opens on that passage.
  anchor: BriefingChatAnchor
  turns: readonly string[]
}

type ChatFrame = { type?: unknown; delta?: unknown; message?: unknown }

const framesOf = (body: string): ChatFrame[] => {
  const frames: ChatFrame[] = []
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const json = line.slice('data:'.length).trim()
    if (json === '') continue
    frames.push(JSON.parse(json) as ChatFrame)
  }
  return frames
}

// The turn's text, or a sentence naming what the stream said instead. A turn
// that errored, or that stopped before its `done` frame, has no reply to
// grade: returning the text so far would compare two truncated answers.
const replyOf = (body: string, conversationId: string): string => {
  let reply = ''
  let done = false
  for (const frame of framesOf(body)) {
    if (frame.type === 'error') {
      const message =
        typeof frame.message === 'string' ? frame.message : 'no message'
      throw new Error(
        `chat conversation ${conversationId} streamed an error: ${message}`,
      )
    }
    if (frame.type === 'text' && typeof frame.delta === 'string') {
      reply += frame.delta
    }
    if (frame.type === 'done') done = true
  }
  if (!done) {
    throw new Error(
      `chat conversation ${conversationId} ended without a done frame`,
    )
  }
  return reply
}

const converse = async (
  ctx: EvalContext,
  messages: {
    scope: string
    conversationId: string
    path: string
    turns: readonly string[]
  },
): Promise<string> => {
  const { scope, conversationId, path, turns } = messages
  const exchanges: string[] = []
  for (const [index, content] of turns.entries()) {
    const body = await ctx.postEventStream(path, { content })
    const reply = replyOf(body, conversationId)
    await ctx.annotate(
      `Turn ${index + 1} (${scope}, conversation ${conversationId}): ` +
        excerpt(reply),
      'chat-turn',
    )
    exchanges.push(`User: ${content}\nAssistant: ${reply}`)
  }
  return exchanges.join('\n\n')
}

export const chatTurns = async (
  ctx: EvalContext,
  { scope, turns, anchor }: ChatTurnsInput,
): Promise<string> => {
  const { conversationId } = await ctx.api.post<{ conversationId: string }>(
    '/v1/chats',
    { scope, ...(anchor === undefined ? {} : { anchor }) },
  )
  return converse(ctx, {
    scope,
    conversationId,
    path: `/v1/chats/${conversationId}/messages?scope=${encodeURIComponent(scope)}`,
    turns,
  })
}

export const briefingChatTurns = async (
  ctx: EvalContext,
  { meetingDate, anchor, turns }: BriefingChatTurnsInput,
): Promise<string> => {
  const { annotationId, conversationId } = await ctx.api.post<{
    annotationId: string
    conversationId: string
  }>('/v1/briefing-chats', { meetingDate, anchor })
  return converse(ctx, {
    scope: 'briefing_annotation',
    conversationId,
    path: `/v1/briefing-chats/${annotationId}/messages`,
    turns,
  })
}
