/**
 * The priority chat client — the general chat bound to `scope=priority_flow`.
 * One conversation for the life of a priority, keyed server-side by the
 * priority anchor passed to createConversation.
 */

'use client'

import { createAgentChatClient } from '../../../shared/agent-chat/chatClient'

export const priorityFlowChatApi = createAgentChatClient(
  'priority_flow',
  'priorities-chat',
)
