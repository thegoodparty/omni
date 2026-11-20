/**
 * localStorage-backed BriefingChatClient for development.
 *
 * Mirrors the two annotation-keyed calls in chat-api.ts so the briefing UI
 * keeps working without the gp-api backend. Turns and history are not here —
 * they go through the shared scope client, which needs a real conversation.
 *
 * Storage layout:
 *   gp.briefings.chat.conversations -> ChatConversation[]
 *   gp.briefings.chat.annotation_map -> { [annotationId]: conversationId }
 *
 * `create` is retained alongside the `BriefingChatClient` shape because
 * `annotations-stub.ts` still calls it directly when creating a chat-kind
 * annotation.
 */

'use client'

import type { BriefingChatClient } from './chat-client'
import type { ChatConversation } from './types'
import { newId, nowIso, safeStorage } from './storage-utils'

const CONV_KEY = 'gp.briefings.chat.conversations'
const ANNOTATION_MAP_KEY = 'gp.briefings.chat.annotation_map'
const DEV_USER_ID = 1

const readConvs = (): ChatConversation[] => {
  const s = safeStorage()
  if (!s) return []
  const raw = s.getItem(CONV_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as ChatConversation[]
    return []
  } catch {
    return []
  }
}

const writeConvs = (items: ChatConversation[]) => {
  const s = safeStorage()
  if (!s) return
  s.setItem(CONV_KEY, JSON.stringify(items))
}

const readAnnotationMap = (): Record<string, string> => {
  const s = safeStorage()
  if (!s) return {}
  const raw = s.getItem(ANNOTATION_MAP_KEY)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>
    }
    return {}
  } catch {
    return {}
  }
}

const writeAnnotationMap = (map: Record<string, string>) => {
  const s = safeStorage()
  if (!s) return
  s.setItem(ANNOTATION_MAP_KEY, JSON.stringify(map))
}

const conversationIdForAnnotation = (annotationId: string): string | null => {
  const map = readAnnotationMap()
  return map[annotationId] ?? null
}

const recordAnnotationConversation = (
  annotationId: string,
  conversationId: string,
) => {
  const map = readAnnotationMap()
  map[annotationId] = conversationId
  writeAnnotationMap(map)
}

const makeConversation = (): ChatConversation => {
  const id = newId('conv')
  const now = nowIso()
  return {
    id,
    ownerUserId: DEV_USER_ID,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

const legacyCreate = async (): Promise<ChatConversation> => {
  const conversation = makeConversation()
  writeConvs([...readConvs(), conversation])
  return conversation
}

const softDeleteConversation = (conversationId: string) => {
  const convs = readConvs()
  const idx = convs.findIndex((c) => c.id === conversationId)
  if (idx < 0) return
  const existing = convs[idx]
  if (!existing) return
  convs[idx] = {
    ...existing,
    deletedAt: nowIso(),
    updatedAt: nowIso(),
  }
  writeConvs(convs)
}

interface ChatStubLegacy {
  /**
   * Legacy: used by annotations-stub.ts to mint a fresh chat conversation
   * before storing a chat-kind annotation row. New code should use
   * `createBriefingChat` instead.
   */
  create(): Promise<ChatConversation>
  /**
   * Legacy: lets annotations-stub.ts record the annotation->conversation
   * mapping after it mints the annotation row, so that `softDelete` can
   * resolve the conversation from the annotation id.
   */
  recordAnnotationConversation(
    annotationId: string,
    conversationId: string,
  ): void
}

export const chatStub: BriefingChatClient & ChatStubLegacy = {
  async createBriefingChat({ meetingDate: _meetingDate, anchor: _anchor }) {
    const conversation = makeConversation()
    writeConvs([...readConvs(), conversation])
    const annotationId = newId('ann')
    recordAnnotationConversation(annotationId, conversation.id)
    return { annotationId, conversationId: conversation.id }
  },

  async softDelete(annotationId) {
    const conversationId = conversationIdForAnnotation(annotationId)
    if (!conversationId) {
      // No map entry — the annotation was created outside the briefing chat
      // flow. Warn so the bug surfaces in dev rather than silently
      // soft-deleting nothing.
      console.warn(
        '[chat-stub] softDelete: no conversation mapped for annotation',
        annotationId,
      )
      return
    }
    softDeleteConversation(conversationId)
  },

  // Legacy entry point preserved for annotations-stub.ts.
  create: legacyCreate,
  recordAnnotationConversation,
}
