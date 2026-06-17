'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { chiefOfStaffChatApi } from './chat-api'
import type { ChatConversationDto } from './contracts'

const HISTORY_KEY = ['chief-of-staff', 'chat-history'] as const

export const useChatHistory = (
  enabled: boolean,
): UseQueryResult<ChatConversationDto[]> =>
  useQuery({
    queryKey: HISTORY_KEY,
    queryFn: () => chiefOfStaffChatApi.listConversations(),
    enabled,
  })

export const useDeleteConversation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => chiefOfStaffChatApi.softDelete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HISTORY_KEY })
    },
  })
}

export { HISTORY_KEY }
