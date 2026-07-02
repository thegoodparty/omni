/**
 * Chief of Staff chat client — the general chat bound to `scope=chief_of_staff`.
 * The implementation is the shared, scope-parameterized `createAgentChatClient`
 * (see `app/dashboard/shared/agent-chat/chatClient.ts`); this only binds the
 * scope and the Sentry surface tag.
 */

'use client'

import { createAgentChatClient } from '../../shared/agent-chat/chatClient'
import type { ChiefOfStaffChatClient } from './chat-client'

export const chiefOfStaffChatApi: ChiefOfStaffChatClient =
  createAgentChatClient('chief_of_staff', 'chief-of-staff-chat')
