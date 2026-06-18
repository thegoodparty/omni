'use client'

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { AiChatClient, ChatConversationDto } from './types'

export const HISTORY_QUERY_KEY = (surface: string) =>
  ['ai-chat-history', surface] as const

export const useAiChatHistory = (
  chatApi: AiChatClient,
  surface: string,
  enabled: boolean,
): UseQueryResult<ChatConversationDto[]> =>
  useQuery({
    queryKey: HISTORY_QUERY_KEY(surface),
    queryFn: () => chatApi.listConversations(),
    enabled,
  })

export const useDeleteAiConversation = (chatApi: AiChatClient, surface: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => chatApi.softDelete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY(surface) })
    },
  })
}
