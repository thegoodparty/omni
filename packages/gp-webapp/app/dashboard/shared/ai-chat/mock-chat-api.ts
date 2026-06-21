import type { AiChatClient, ChatConversationDto, ChatMessageDto } from './types'

const MOCK_CONVERSATIONS: ChatConversationDto[] = [
  {
    conversationId: 'mock-1',
    scope: 'campaign_assistant',
    title: 'Housing policy discussion',
    ownerUserId: 1,
    deletedAt: null,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    conversationId: 'mock-2',
    scope: 'campaign_assistant',
    title: null,
    ownerUserId: 1,
    deletedAt: null,
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 172800000).toISOString(),
  },
]

const MOCK_MESSAGES: ChatMessageDto[] = [
  {
    id: 'msg-1',
    conversationId: 'mock-1',
    role: 'user',
    content: 'What are my top priorities this week?',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'msg-2',
    conversationId: 'mock-1',
    role: 'assistant',
    content:
      "Based on your campaign data, here are your top priorities:\n\n1. **Voter outreach** — You're at 34% of your contact goal\n2. **Fundraising** — Q3 deadline in 12 days\n3. **Debate prep** — Scheduled for Thursday",
    createdAt: new Date(Date.now() - 86400000 + 5000).toISOString(),
  },
]

const MOCK_REPLY =
  "I've reviewed your campaign data. Here's what I found:\n\n" +
  '- Your voter contact rate is **34%** of the goal\n' +
  '- The housing zoning vote on Monday is your most urgent item\n' +
  '- Mayor Stark is the swing vote — I drafted talking points for you\n\n' +
  'Would you like me to prepare a briefing?'

export const mockChatApi: AiChatClient = {
  async createConversation() {
    await new Promise((r) => setTimeout(r, 300))
    return { conversationId: `mock-${Date.now()}` }
  },
  async listMessages(conversationId) {
    await new Promise((r) => setTimeout(r, 200))
    return conversationId === 'mock-1' ? MOCK_MESSAGES : []
  },
  async listConversations() {
    await new Promise((r) => setTimeout(r, 200))
    return MOCK_CONVERSATIONS
  },
  async *streamMessage() {
    await new Promise((r) => setTimeout(r, 600))
    const words = MOCK_REPLY.split(' ')
    for (const word of words) {
      yield { type: 'text' as const, delta: word + ' ' }
      await new Promise((r) => setTimeout(r, 40))
    }
    yield { type: 'done' as const, assistantMessageId: `mock-${Date.now()}` }
  },
  async softDelete() {
    await new Promise((r) => setTimeout(r, 100))
  },
}
