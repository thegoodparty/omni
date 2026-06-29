import { z } from "zod";
import { zCoerceDate } from "../shared/Date.schema";
import {
  ChatMessageRoleSchema,
  ChatMessageSegmentKindSchema,
  ChatScopeSchema,
} from "../generated/enums";

// Scope-generic chat surface (Chief of Staff is the first consumer). Shared by
// gp-api and gp-webapp. The SSE event shapes are lifted from the briefing
// chat's ChatStreamChunk so a single client renderer handles both kinds.

// --- Anchor ------------------------------------------------------------------

export const ChatAnchorSnapshotSchema = z.object({
  title: z.string().max(500),
  summary: z.string().max(5_000),
  highlightedText: z.string().max(2_000).optional(),
});
export type ChatAnchorSnapshot = z.infer<typeof ChatAnchorSnapshotSchema>;

export const ChatAnchorSchema = z.object({
  resourceType: z.literal("community_issue"),
  resourceId: z.string(),
  url: z.string(),
  snapshot: ChatAnchorSnapshotSchema,
});
export type ChatAnchor = z.infer<typeof ChatAnchorSchema>;

// --- Create / find-or-create -------------------------------------------------

// Params used to resolve (find-or-create) a conversation for a scope. v1 only
// supports chief_of_staff, which keys on the authed user + organization slug
// (the slug comes from the X-Organization-Slug header, not the body).
export const CreateChatRequestSchema = z.object({
  scope: ChatScopeSchema,
  anchor: ChatAnchorSchema.optional(),
});
export type CreateChatRequest = z.infer<typeof CreateChatRequestSchema>;

export const CreateChatResponseSchema = z.object({
  conversationId: z.string(),
  created: z.boolean(),
});
export type CreateChatResponse = z.infer<typeof CreateChatResponseSchema>;

// --- Send a message ----------------------------------------------------------

export const CHAT_MESSAGE_MAX_LENGTH = 10_000;

export const SendChatMessageRequestSchema = z.object({
  content: z.string().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
  clientMessageId: z.guid().optional(),
});
export type SendChatMessageRequest = z.infer<
  typeof SendChatMessageRequestSchema
>;

// --- Replay a conversation ---------------------------------------------------

// One block of an assistant turn's display structure: a run of text, or a
// single tool call. Consecutive `tool` segments are grouped into one pill row
// by the UI. `ordinal` is implied by array position.
export const ChatMessageSegmentSchema = z.object({
  kind: ChatMessageSegmentKindSchema,
  text: z.string().nullable().optional(),
  toolName: z.string().nullable().optional(),
});
export type ChatMessageSegment = z.infer<typeof ChatMessageSegmentSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: ChatMessageRoleSchema,
  content: z.string(),
  createdAt: zCoerceDate(),
  // Present only for assistant turns that used tools (persisted display
  // structure). Absent on older messages and pure-text turns — render
  // `content` flat in that case.
  segments: z.array(ChatMessageSegmentSchema).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatConversationSchema = z.object({
  conversationId: z.string(),
  scope: ChatScopeSchema,
  title: z.string().nullable(),
  messages: z.array(ChatMessageSchema),
});
export type ChatConversation = z.infer<typeof ChatConversationSchema>;

// --- History list ------------------------------------------------------------

export const ChatHistoryItemSchema = z.object({
  conversationId: z.string(),
  title: z.string().nullable(),
  createdAt: zCoerceDate(),
  updatedAt: zCoerceDate(),
});
export type ChatHistoryItem = z.infer<typeof ChatHistoryItemSchema>;

export const ChatHistoryResponseSchema = z.object({
  conversations: z.array(ChatHistoryItemSchema),
});
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;

export const ChatHistoryQuerySchema = z.object({
  scope: ChatScopeSchema,
});
export type ChatHistoryQuery = z.infer<typeof ChatHistoryQuerySchema>;

// --- SSE stream events -------------------------------------------------------

export const CHAT_STREAM_ERROR_CODE_VALUES = [
  "conversation_not_found",
  "upstream_unavailable",
  "rate_limited",
  "aborted",
  "internal",
] as const;
export const ChatStreamErrorCodeSchema = z.enum(CHAT_STREAM_ERROR_CODE_VALUES);
export type ChatStreamErrorCode = z.infer<typeof ChatStreamErrorCodeSchema>;

export const ChatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({
    type: z.literal("tool_call"),
    toolName: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_result"),
    toolName: z.string(),
    result: z.unknown(),
  }),
  z.object({
    type: z.literal("done"),
    assistantMessageId: z.string().optional(),
  }),
  z.object({
    type: z.literal("error"),
    code: ChatStreamErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
