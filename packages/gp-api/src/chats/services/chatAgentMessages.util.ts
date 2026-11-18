import type { ModelMessage } from 'ai'
import { z } from 'zod'
import { isToolRefusal } from '@goodparty_org/contracts'
import {
  AgentMessage,
  AgentMessageRole,
  ChatMessageRole,
  ChatMessageSegment,
  ChatMessageSegmentKind,
  Prisma,
} from '../../generated/prisma'
import type { LlmStreamUsage } from '@/llm/services/llm.service'
import type {
  ChatMessageWithSegments,
  PersistedSegment,
} from './chatStore.prisma'

// While on, every chat reader reads AgentMessage instead of ChatMessage. Both
// are written either way, so flipping it back is the rollback.
export const CHAT_AGENT_MESSAGE_FLAG = 'chat-agent-message'

export type AgentMessageDraft = {
  role: AgentMessageRole
  parts: Prisma.JsonValue[]
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
}

export type StoredAgentMessage = Pick<
  AgentMessage,
  | 'id'
  | 'conversationId'
  | 'role'
  | 'parts'
  | 'model'
  | 'inputTokens'
  | 'outputTokens'
  | 'createdAt'
>

type JsonObject = Prisma.JsonObject

type SegmentLike = Pick<PersistedSegment, 'kind'> & {
  text?: string | null
  toolName?: string | null
  toolCallId?: string | null
  payload?: unknown
}

const JsonSchema: z.ZodType<Prisma.JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonSchema),
    z.record(z.string(), JsonSchema),
  ]),
)

// Parts are JSON by construction (model output and tool results the AI SDK
// already serialised); the round trip drops undefined fields the way the
// database would.
const toJson = (value: unknown): Prisma.JsonValue =>
  JsonSchema.parse(JSON.parse(JSON.stringify(value ?? null)))

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// The AI SDK has no citation part, so a citation rides as an empty text part
// that names it. Replay and display both read text through readParts, which
// keeps it out of the text.
const citationPart = (payload: unknown): Prisma.JsonValue => ({
  type: 'text',
  text: '',
  providerOptions: {
    goodparty: { citation: toJson(payload) },
  },
})

const citationOf = (part: JsonObject): unknown => {
  const options = part['providerOptions']
  if (!isObject(options)) return undefined
  const goodparty = options['goodparty']
  if (!isObject(goodparty)) return undefined
  return goodparty['citation']
}

const contentParts = (message: ModelMessage): JsonObject[] =>
  typeof message.content === 'string'
    ? [{ type: 'text', text: message.content }]
    : (Array.isArray(message.content) ? message.content : [])
        .map(toJson)
        .filter(isObject)

const segmentToPart = (segment: SegmentLike): Prisma.JsonValue => {
  if (segment.kind === ChatMessageSegmentKind.citation) {
    return citationPart(segment.payload)
  }
  if (segment.kind === ChatMessageSegmentKind.tool) {
    return {
      type: 'tool-call',
      // Older segments predate toolCallId; '' reads back as null.
      toolCallId: segment.toolCallId ?? '',
      toolName: segment.toolName ?? '',
      input: toJson(segment.payload),
    }
  }
  return { type: 'text', text: segment.text ?? '' }
}

// One ChatMessage as AgentMessage rows: what the backfill writes, and what a
// turn writes when its model messages cannot be stored as they are. Tool
// results were never stored on ChatMessage, so none come back here.
export const chatMessageToAgentMessages = (
  message: Pick<
    ChatMessageWithSegments,
    'role' | 'content' | 'model' | 'inputTokens' | 'outputTokens' | 'segments'
  >,
): AgentMessageDraft[] => {
  if (message.role === ChatMessageRole.user) {
    return [
      {
        role: AgentMessageRole.user,
        parts: [{ type: 'text', text: message.content }],
      },
    ]
  }
  if (message.role !== ChatMessageRole.assistant) return []
  return [
    {
      role: AgentMessageRole.assistant,
      parts:
        message.segments.length > 0
          ? message.segments.map(segmentToPart)
          : [{ type: 'text', text: message.content }],
      model: message.model,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
    },
  ]
}

const refusedToolCallIds = (rows: StoredAgentMessage[]): Set<string> => {
  const refused = new Set<string>()
  for (const row of rows) {
    if (!Array.isArray(row.parts)) continue
    for (const part of row.parts) {
      if (!isObject(part) || part['type'] !== 'tool-result') continue
      const output = part['output']
      if (
        isObject(output) &&
        output['type'] === 'json' &&
        isToolRefusal(output['value'])
      ) {
        refused.add(String(part['toolCallId']))
      }
    }
  }
  return refused
}

const sumTokens = (
  rows: StoredAgentMessage[],
  field: 'inputTokens' | 'outputTokens',
): number | null =>
  rows.every((row) => row[field] === null)
    ? null
    : rows.reduce((sum, row) => sum + (row[field] ?? 0), 0)

const toChatMessage = (
  group: StoredAgentMessage[],
): ChatMessageWithSegments => {
  const first = group[0]!
  if (first.role === AgentMessageRole.user) {
    const text = (Array.isArray(first.parts) ? first.parts : [])
      .filter(isObject)
      .map((part) => (part['type'] === 'text' ? String(part['text']) : ''))
      .join('')
    return {
      id: first.id,
      conversationId: first.conversationId ?? '',
      role: ChatMessageRole.user,
      content: text,
      clientMessageId: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      createdAt: first.createdAt,
      segments: [],
    }
  }
  const assistants = group.filter(
    (row) => row.role === AgentMessageRole.assistant,
  )
  const last = assistants[assistants.length - 1]!
  const refused = refusedToolCallIds(group)
  const segments: Omit<
    ChatMessageSegment,
    'id' | 'chatMessageId' | 'ordinal'
  >[] = []
  for (const row of assistants) {
    for (const part of Array.isArray(row.parts) ? row.parts : []) {
      if (!isObject(part)) continue
      if (part['type'] === 'text') {
        const citation = citationOf(part)
        if (citation !== undefined) {
          segments.push({
            kind: ChatMessageSegmentKind.citation,
            text: null,
            toolName: null,
            toolCallId: null,
            payload: toJson(citation),
          })
          continue
        }
        const text = String(part['text'] ?? '')
        if (!text) continue
        const previous = segments[segments.length - 1]
        if (previous?.kind === ChatMessageSegmentKind.text) {
          previous.text = `${previous.text ?? ''}${text}`
        } else {
          segments.push({
            kind: ChatMessageSegmentKind.text,
            text,
            toolName: null,
            toolCallId: null,
            payload: null,
          })
        }
        continue
      }
      if (part['type'] === 'tool-call') {
        const toolCallId = String(part['toolCallId'] ?? '')
        const input = part['input']
        segments.push({
          kind: ChatMessageSegmentKind.tool,
          text: null,
          toolName: String(part['toolName'] ?? ''),
          toolCallId: toolCallId || null,
          payload:
            refused.has(toolCallId) || input === undefined
              ? null
              : toJson(input),
        })
      }
    }
  }
  const structured = segments.some(
    (s) =>
      s.kind === ChatMessageSegmentKind.tool ||
      s.kind === ChatMessageSegmentKind.citation,
  )
  return {
    id: last.id,
    conversationId: first.conversationId ?? '',
    role: ChatMessageRole.assistant,
    content: segments
      .filter((s) => s.kind === ChatMessageSegmentKind.text)
      .map((s) => s.text ?? '')
      .join(''),
    clientMessageId: null,
    model:
      [...assistants].reverse().find((row) => row.model !== null)?.model ??
      null,
    inputTokens: sumTokens(assistants, 'inputTokens'),
    outputTokens: sumTokens(assistants, 'outputTokens'),
    createdAt: first.createdAt,
    segments: structured
      ? segments.map((s, ordinal) => ({
          ...s,
          id: `${last.id}:${ordinal}`,
          chatMessageId: last.id,
          ordinal,
        }))
      : [],
  }
}

// AgentMessage rows, in index order, as the ChatMessage list every chat
// reader already takes. A user row is one message. An assistant row starts a
// turn unless it follows a tool row: the rows of one model loop (assistant,
// tool, assistant...) read back as the one reply the user saw, keyed by its
// last assistant row, which carries the ChatMessage id it was written with.
export const agentMessagesToChatMessages = (
  rows: StoredAgentMessage[],
): ChatMessageWithSegments[] => {
  const groups: StoredAgentMessage[][] = []
  let previous: StoredAgentMessage | undefined
  for (const row of rows) {
    const startsMessage =
      row.role === AgentMessageRole.user ||
      (row.role === AgentMessageRole.assistant &&
        previous?.role !== AgentMessageRole.tool)
    if (startsMessage || groups.length === 0) {
      groups.push([row])
    } else {
      groups[groups.length - 1]!.push(row)
    }
    previous = row
  }
  return groups
    .filter((group) => group.some((row) => row.role !== AgentMessageRole.tool))
    .map(toChatMessage)
}

const comparable = (
  message: Pick<ChatMessageWithSegments, 'content'> & {
    segments: SegmentLike[]
  },
): string =>
  JSON.stringify({
    content: message.content,
    segments: message.segments.map((s) => ({
      kind: s.kind,
      text: s.text ?? null,
      toolName: s.toolName ?? null,
      toolCallId: s.toolCallId ?? null,
      payload: s.payload ?? null,
    })),
  })

// True when the two read the same to every chat reader: the same text and
// the same pills, cards and citations in the same order.
export const sameChatMessage = (
  a: Parameters<typeof comparable>[0],
  b: Parameters<typeof comparable>[0],
): boolean => comparable(a) === comparable(b)

const toolCallParts = (message: ModelMessage): JsonObject[] =>
  contentParts(message).filter((part) => part['type'] === 'tool-call')

// A finished turn's model messages (assistant steps and the tool results
// between them) as AgentMessage rows, laid out in the order the turn
// streamed, so they read back as exactly the reply the user saw. Null when
// they cannot be: the caller then stores the reply the way the backfill does.
export const turnToAgentMessages = (args: {
  content: string
  segments: PersistedSegment[]
  persistedSegments?: PersistedSegment[]
  responseMessages: ModelMessage[]
  stepUsages: LlmStreamUsage[]
  model: string
}): AgentMessageDraft[] | null => {
  const { responseMessages, segments } = args
  const assistants = responseMessages.filter((m) => m.role === 'assistant')
  if (assistants.length === 0) return null
  if (assistants.length !== args.stepUsages.length) return null

  const clientCallIds = assistants.map(
    (m) =>
      new Set(
        toolCallParts(m)
          .filter((part) => part['providerExecuted'] !== true)
          .map((part) => String(part['toolCallId'])),
      ),
  )
  const placed = assistants.map((): Prisma.JsonValue[] => [])
  const pending = new Set(clientCallIds[0])
  let step = 0
  for (const segment of segments) {
    while (
      clientCallIds[step]!.size > 0 &&
      pending.size === 0 &&
      step + 1 < assistants.length
    ) {
      step += 1
      for (const id of clientCallIds[step]!) pending.add(id)
    }
    if (segment.kind !== ChatMessageSegmentKind.tool) {
      placed[step]!.push(segmentToPart(segment))
      continue
    }
    const parts = contentParts(assistants[step]!)
    const call = parts.find(
      (part) =>
        part['type'] === 'tool-call' &&
        part['toolCallId'] === segment.toolCallId,
    )
    if (!call) return null
    placed[step]!.push(toJson(call))
    if (call['providerExecuted'] === true) {
      const result = parts.find(
        (part) =>
          part['type'] === 'tool-result' &&
          part['toolCallId'] === segment.toolCallId,
      )
      if (result) placed[step]!.push(toJson(result))
    }
    pending.delete(String(segment.toolCallId))
  }
  const streamedCallIds = new Set(
    segments
      .filter((s) => s.kind === ChatMessageSegmentKind.tool)
      .map((s) => s.toolCallId),
  )
  const everyCallPlaced = assistants.every((m) =>
    toolCallParts(m).every((part) =>
      streamedCallIds.has(String(part['toolCallId'])),
    ),
  )
  if (!everyCallPlaced) return null

  let assistantIndex = 0
  const drafts = responseMessages.map((message): AgentMessageDraft => {
    if (message.role !== 'assistant') {
      return {
        role: AgentMessageRole.tool,
        parts: contentParts(message).map(toJson),
      }
    }
    const usage = args.stepUsages[assistantIndex]!
    const parts = placed[assistantIndex]!
    assistantIndex += 1
    return {
      role: AgentMessageRole.assistant,
      parts,
      model: args.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    }
  })
  const readBack = agentMessagesToChatMessages(
    drafts.map((draft, i) => ({
      id: String(i),
      conversationId: null,
      role: draft.role,
      parts: toJson(draft.parts),
      model: draft.model ?? null,
      inputTokens: draft.inputTokens ?? null,
      outputTokens: draft.outputTokens ?? null,
      createdAt: new Date(0),
    })),
  )
  const persisted = args.persistedSegments ?? []
  if (
    readBack.length !== 1 ||
    !sameChatMessage(readBack[0]!, {
      content: args.content,
      segments: persisted,
    })
  ) {
    return null
  }
  return drafts
}
