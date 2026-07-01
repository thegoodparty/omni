'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { chiefOfStaffChatApi } from './chat-api'
import type { ManagerChatClient } from '../../shared/manager-chat/chatClient'
import type { ChatConversationDto } from './contracts'

// Chief of Staff's history query key; also the default so existing CoS callers
// need not pass one. Other scopes (e.g. Campaign Manager) pass their own.
const HISTORY_KEY = ['chief-of-staff', 'chat-history'] as const

export const useChatHistory = (
  enabled: boolean,
  client: ManagerChatClient = chiefOfStaffChatApi,
  historyKey: readonly unknown[] = HISTORY_KEY,
): UseQueryResult<ChatConversationDto[]> =>
  useQuery({
    queryKey: historyKey,
    queryFn: () => client.listConversations(),
    enabled,
  })

export const useDeleteConversation = (
  client: ManagerChatClient = chiefOfStaffChatApi,
  historyKey: readonly unknown[] = HISTORY_KEY,
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => client.softDelete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: historyKey })
    },
  })
}

export { HISTORY_KEY }
