'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useOrganization } from '@shared/organization-picker'
import { chiefOfStaffChatApi } from './chat-api'
import type { AgentChatClient } from '../../shared/agent-chat/chatClient'
import type { ChatConversationDto } from './contracts'

// Chief of Staff's history query key; also the default so existing CoS callers
// need not pass one. Other scopes (e.g. Campaign Manager) pass their own.
const HISTORY_KEY = ['chief-of-staff', 'chat-history'] as const

// The list is per ORGANIZATION, not just per scope: gp-api filters it by the
// X-Organization-Slug header, and a conversation id can only be loaded under
// the org that owns it. So the org is part of the cache identity. Without it an
// org switch leaves the previous org's list readable under the new org's
// header, and a resume taken from that stale list asks for a conversation this
// org does not own — a 404 the client reported as a bug (ENG-11670).
export const chatHistoryKey = (
  historyKey: readonly unknown[],
  organizationSlug: string | undefined,
): readonly unknown[] => [...historyKey, organizationSlug ?? null]

export const useChatHistory = (
  enabled: boolean,
  client: AgentChatClient = chiefOfStaffChatApi,
  historyKey: readonly unknown[] = HISTORY_KEY,
): UseQueryResult<ChatConversationDto[]> => {
  const organizationSlug = useOrganization()?.slug
  return useQuery({
    queryKey: chatHistoryKey(historyKey, organizationSlug),
    queryFn: () => client.listConversations(),
    enabled,
  })
}

export const useDeleteConversation = (
  client: AgentChatClient = chiefOfStaffChatApi,
  historyKey: readonly unknown[] = HISTORY_KEY,
) => {
  const queryClient = useQueryClient()
  const organizationSlug = useOrganization()?.slug
  return useMutation({
    mutationFn: (id: string) => client.softDelete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: chatHistoryKey(historyKey, organizationSlug),
      })
    },
  })
}

export { HISTORY_KEY }
