/**
 * Chief of Staff chat client — the general chat bound to `scope=chief_of_staff`.
 * The implementation is the shared, scope-parameterized `createManagerChatClient`
 * (see `app/dashboard/shared/manager-chat/chatClient.ts`); this only binds the
 * scope and the Sentry surface tag.
 */

'use client'

import { createManagerChatClient } from '../../shared/manager-chat/chatClient'
import type { ChiefOfStaffChatClient } from './chat-client'

export const chiefOfStaffChatApi: ChiefOfStaffChatClient =
  createManagerChatClient('chief_of_staff', 'chief-of-staff-chat')
