/**
 * The priority flow's chat client. Bound to `chief_of_staff` on purpose: the
 * flow has no scope of its own yet, and that agent already carries the office
 * context, the priorities, the constituent data, the briefings, and the
 * community issues this flow needs to say anything true about a priority.
 *
 * Two consequences while it borrows that scope: flow conversations show up in
 * the Chief of Staff history, and the agent answers in prose rather than the
 * flow's structured cards (it has no present_* tools). Both go away when
 * gp-api gets a `priority_flow` scope with the prompt in
 * docs/serve-priority-flow-prompt.md.
 */

'use client'

import { createAgentChatClient } from '../../shared/agent-chat/chatClient'

export const priorityFlowChatApi = createAgentChatClient(
  'chief_of_staff',
  'priority-flow-chat',
)
