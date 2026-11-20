/**
 * Briefing chat's turns and history — the shared, scope-parameterized client
 * bound to `scope=briefing_annotation`. It speaks `/v1/chats/:conversationId`,
 * exactly like every other scope; the annotation-keyed create and delete stay
 * in `@shared/briefings/chat-api`.
 */

'use client'

import { createAgentChatClient } from '../shared/agent-chat/chatClient'

export const briefingChatApi = createAgentChatClient(
  'briefing_annotation',
  'briefing-ask-ai',
)
