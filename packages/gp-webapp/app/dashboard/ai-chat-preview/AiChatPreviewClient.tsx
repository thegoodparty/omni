'use client'

import { useState } from 'react'
import { AiChatBar, AiChatSurface } from '../shared/ai-chat'
import type { AiChatClient, AiChatConfig, ChatConversationDto, ChatMessageDto } from '../shared/ai-chat'

// ---------------------------------------------------------------------------
// Mock API — simulates streaming with a fake response
// ---------------------------------------------------------------------------

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

const mockChatApi: AiChatClient = {
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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const config: AiChatConfig = {
  title: 'AI Campaign Manager',
  subtitle: 'Always on, working on your campaign',
  placeholder: 'How can I help?',
  introSeenKey: 'ai-campaign-manager-intro-seen-preview',
  suggestions: [
    "What's most urgent this week?",
    'How is my voter outreach going?',
    'Help me prepare for the debate',
  ],
  introMessages: [
    "Hi, I'm your AI Campaign Manager.",
    'I keep track of your campaign goals, voter outreach, and key deadlines.',
    'Ask me anything, or tell me what you need help with today.',
  ],
}

// ---------------------------------------------------------------------------
// Preview page
// ---------------------------------------------------------------------------

export default function AiChatPreviewClient(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [initialConversationId, setInitialConversationId] = useState<string | null>(null)

  const handleOpen = () => {
    setInitialConversationId(null)
    setOpen(true)
  }

  const handleOpenConversation = (id: string) => {
    setInitialConversationId(id)
    setOpen(true)
  }

  return (
    <>
      <div className="flex flex-col gap-6 p-6">
        <h1 className="text-2xl font-semibold">AI Chat Component Preview</h1>
        <p className="text-muted-foreground">
          The sticky input bar is fixed at the bottom of the screen. Click it to open the chat.
          This uses a mock API — no real backend needed.
        </p>
        <div className="rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">What to check:</p>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>Footer bar — gradient border, clock icon, mic, sparkle button</li>
            <li>Click bar → drawer opens from bottom</li>
            <li>Suggestion chips on empty chat</li>
            <li>Send a message → streaming response</li>
            <li>Clock icon → previous conversations popover</li>
            <li>Intro messages animate on first open (clears from localStorage)</li>
          </ul>
        </div>
      </div>

      <AiChatBar
        chatApi={mockChatApi}
        config={config}
        firstName="Renee"
        onOpen={handleOpen}
        onOpenConversation={handleOpenConversation}
      />

      <AiChatSurface
        chatApi={mockChatApi}
        config={config}
        open={open}
        onOpenChange={setOpen}
        initialConversationId={initialConversationId}
      />
    </>
  )
}
