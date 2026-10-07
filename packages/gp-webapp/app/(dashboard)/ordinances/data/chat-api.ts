/**
 * Ordinance-flow chat client — the general chat bound to `scope=ordinance_flow`.
 * Reuses the shared, scope-parameterized `createAgentChatClient`; this only
 * binds the scope and the Sentry surface tag. Each (ordinance, step) conversation
 * is keyed server-side by the anchor passed to createConversation.
 */

'use client'

import { createAgentChatClient } from '../../shared/agent-chat/chatClient'

export const ordinanceFlowChatApi = createAgentChatClient(
  'ordinance_flow',
  'ordinances-chat',
)
