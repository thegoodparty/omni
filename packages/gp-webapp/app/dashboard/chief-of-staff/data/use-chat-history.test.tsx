import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useChatHistory, chatHistoryKey, HISTORY_KEY } from './use-chat-history'
import type {
  AgentChatClient,
  ChatConversationDto,
} from '../../shared/agent-chat/chatClient'

// The selected org is what the cache key has to carry, so the mock is mutable:
// each test re-renders the same hook under a different organization.
const selected = vi.hoisted(() => ({
  slug: 'campaign-1' as string | undefined,
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () =>
    selected.slug === undefined ? undefined : { slug: selected.slug },
}))

const conversation = (conversationId: string): ChatConversationDto => ({
  conversationId,
  scope: 'chief_of_staff',
  title: conversationId,
  ownerUserId: 1,
  deletedAt: null,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
})

// One client for the whole file, the way `helpers/test-utils/render` keeps a
// single `testQueryClient`. A client built inside the wrapper makes the cache
// the hook reads depend on which render created the provider, so the assertions
// below could not tell a cache hit from a refetch; with one client, the
// `getQueryData` read sees exactly the cache the hook sees.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

const clientFor = (bySlug: Record<string, ChatConversationDto[]>) => {
  // The list endpoint answers for whichever org the request carried; the test
  // client keys its answer off the org the hook was rendered under, so a cache
  // leak shows up as the wrong list rather than a mystery.
  const listConversations = vi.fn(
    async () => bySlug[selected.slug ?? 'none'] ?? [],
  )
  return {
    client: { listConversations } as unknown as AgentChatClient,
    listConversations,
  }
}

describe('useChatHistory', () => {
  beforeEach(() => {
    selected.slug = 'campaign-1'
    // The client outlives a test, so a leak between tests would read as a
    // cache hit instead of a refetch.
    queryClient.clear()
  })

  // An org switch left the previous org's conversations readable under the new
  // org's cookie, and the Campaign Manager resumes its newest one on open: the
  // resume asked for a conversation the new org does not own, and gp-api 404'd
  // it (ENG-11670).
  it('never serves one organization’s list under another', async () => {
    const { client, listConversations } = clientFor({
      'campaign-1': [conversation('from-campaign-1')],
      'campaign-2': [conversation('from-campaign-2')],
    })

    const { result, rerender } = renderHook(
      () => useChatHistory(true, client),
      { wrapper },
    )

    await waitFor(() =>
      expect(result.current.data).toEqual([conversation('from-campaign-1')]),
    )

    selected.slug = 'campaign-2'
    rerender()

    // Nothing is cached under the new org's key, not even for the render that
    // follows the switch. With an org-less key this is still campaign 1's
    // list, which is the bleed: the switch shows the org we left until the
    // refetch lands.
    expect(result.current.data).toBeUndefined()
    await waitFor(() =>
      expect(result.current.data).toEqual([conversation('from-campaign-2')]),
    )
    // The list we left stays under its own key, so a switch back is a cache
    // read for that org and never the last one this session saw.
    expect(
      queryClient.getQueryData(chatHistoryKey(HISTORY_KEY, 'campaign-1')),
    ).toEqual([conversation('from-campaign-1')])
    expect(listConversations).toHaveBeenCalledTimes(2)

    // ...and switching back answers for that org again, never the one we left.
    selected.slug = 'campaign-1'
    rerender()

    await waitFor(() =>
      expect(result.current.data).toEqual([conversation('from-campaign-1')]),
    )
  })
})
