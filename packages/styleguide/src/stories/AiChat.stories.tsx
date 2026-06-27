'use client'

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Button } from '../components/ui/button'
import { Stepper } from '../components/ui/stepper'
import { RadioGroup, RadioCardItem } from '../components/ui/radio-group'
import AiChatBar from 'app/dashboard/shared/ai-chat/AiChatBar'
import AiChatBody from 'app/dashboard/shared/ai-chat/AiChatBody'
import AiChatSurface from 'app/dashboard/shared/ai-chat/AiChatSurface'
import ChatTimeline from 'app/dashboard/shared/ai-chat/ChatTimeline'
import { mockChatApi } from 'app/dashboard/shared/ai-chat/mock-chat-api'
import type {
  AiChatClient,
  AiChatConfig,
  ChatMessageDto,
  ChatMessageSegment,
} from 'app/dashboard/shared/ai-chat/types'
import type { TimelineItem } from 'app/dashboard/shared/ai-chat/ChatTimeline'

// ---------------------------------------------------------------------------
// Default config shared across stories
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG: AiChatConfig = {
  title: 'AI Campaign Manager',
  subtitle: 'Your personal campaign strategist',
  placeholder: 'Ask me anything about your campaign…',
  introSeenKey: 'storybook-ai-chat-intro',
  suggestions: [
    'What are my top priorities this week?',
    'Draft a housing policy statement',
    'Who are my key swing voters?',
  ],
  introMessages: [
    "Hi there! I'm your AI Campaign Manager.",
    "I can help you strategize, draft content, and stay on top of your campaign. What's on your mind?",
  ],
}

// ---------------------------------------------------------------------------
// Wrapper component used by most stories — combines Bar + Surface
// ---------------------------------------------------------------------------
function AiChatDemo({
  open,
  onOpenChange,
  config = DEFAULT_CONFIG,
  chatApi = mockChatApi,
  initialConversationId,
  firstName,
  messageRenderer,
  bottomSlot,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  config?: AiChatConfig
  chatApi?: AiChatClient
  initialConversationId?: string
  firstName?: string
  messageRenderer?: (content: string) => React.ReactNode
  bottomSlot?: React.ReactNode
}) {
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId ?? null,
  )

  return (
    <div className="relative h-[300px] bg-background">
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Page content area
      </div>

      {!open && (
        <AiChatBar
          chatApi={chatApi}
          config={config}
          firstName={firstName}
          onOpen={() => onOpenChange(true)}
          onOpenConversation={(id) => {
            setConversationId(id)
            onOpenChange(true)
          }}
        />
      )}

      <AiChatSurface
        chatApi={chatApi}
        config={config}
        open={open}
        onOpenChange={onOpenChange}
        initialConversationId={conversationId}
        messageRenderer={messageRenderer}
        bottomSlot={bottomSlot}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------
const DISABLED = { table: { disable: true } }

const meta: Meta = {
  title: 'Patterns/AiChat',
  component: AiChatBody,
  tags: ['autodocs'],
  argTypes: {
    chatApi: DISABLED,
    config: DISABLED,
    conversationIdOverride: DISABLED,
    active: DISABLED,
    onConversationCreated: DISABLED,
    onSelectConversation: DISABLED,
    className: DISABLED,
    messageRenderer: DISABLED,
    bottomSlot: DISABLED,
  },
  decorators: [
    (Story) => {
      // Per-story client so a mutation (e.g. delete) in one story can't leak
      // cached state into another.
      const [client] = useState(() => new QueryClient())
      return (
        <QueryClientProvider client={client}>
          <Story />
        </QueryClientProvider>
      )
    },
  ],
}

export default meta

// ---------------------------------------------------------------------------
// Playground
// ---------------------------------------------------------------------------
type PlaygroundArgs = {
  open: boolean
  firstName: string
  subtitle: string
  timelineVariant: 'none' | 'timeline'
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    open: false,
    firstName: 'Alex',
    subtitle: 'Your personal campaign strategist',
    timelineVariant: 'none',
  },
  argTypes: {
    open: { table: { disable: true } },
    firstName: {
      control: 'text',
      description: 'Personalizes the bar placeholder greeting.',
    },
    subtitle: {
      control: 'text',
      description: 'Subtitle shown under the drawer title.',
    },
    timelineVariant: {
      control: 'inline-radio',
      options: ['none', 'timeline'],
      description:
        'Show a ChatTimeline in the assistant reply: equal-weight dots with quotes and sources.',
    },
  },
  render: ({ open, firstName, subtitle, timelineVariant }) => {
    const [, updateArgs] = useArgs()
    useEffect(() => {
      if (timelineVariant !== 'none') updateArgs({ open: true })
    }, [timelineVariant, updateArgs])
    const config = { ...DEFAULT_CONFIG, subtitle }

    const chatApi = timelineVariant === 'timeline' ? HISTORY_API : mockChatApi

    const renderer = timelineVariant !== 'none' ? timelineRenderer : undefined

    return (
      <AiChatDemo
        key={timelineVariant}
        open={open}
        onOpenChange={(v) => updateArgs({ open: v })}
        config={config}
        firstName={firstName}
        chatApi={chatApi}
        messageRenderer={renderer}
        initialConversationId={
          timelineVariant !== 'none' ? SEEDED_ID : undefined
        }
      />
    )
  },
}

// ---------------------------------------------------------------------------
// Named stories — grouped by dimension
// ---------------------------------------------------------------------------

export const Bar: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => {
    const [open, setOpen] = useState(false)
    return <AiChatDemo open={open} onOpenChange={setOpen} firstName="Alex" />
  },
}

export const DrawerOpen: StoryObj = {
  parameters: {
    controls: { disable: true },
    docs: { story: { inline: false, height: '600px' } },
  },
  render: () => {
    const [open, setOpen] = useState(true)
    return <AiChatDemo open={open} onOpenChange={setOpen} firstName="Jordan" />
  },
}

export const CustomMessageRenderer: StoryObj = {
  parameters: {
    controls: { disable: true },
    docs: { story: { inline: false, height: '600px' } },
  },
  render: () => {
    const [open, setOpen] = useState(true)
    const messageRenderer = (content: string) => (
      <div className="rounded-md border border-border bg-muted p-3 text-sm font-mono text-foreground">
        {content}
      </div>
    )
    return (
      <AiChatDemo
        open={open}
        onOpenChange={setOpen}
        messageRenderer={messageRenderer}
      />
    )
  },
}

export const ChiefOfStaff: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => {
    const [open, setOpen] = useState(false)
    const config: AiChatConfig = {
      title: 'Chief of Staff',
      subtitle: 'Briefings, tasks, and priorities',
      placeholder: 'What do I need to know today?',
      introSeenKey: 'storybook-cos-intro',
      suggestions: [
        "What's on my schedule today?",
        'Summarize the latest donor news',
        'Draft a response to the editor',
      ],
    }
    return <AiChatDemo open={open} onOpenChange={setOpen} config={config} />
  },
}

// ---------------------------------------------------------------------------
// Helpers — seeded mock APIs for rich-content stories
// ---------------------------------------------------------------------------

const SEEDED_ID = 'story-seeded'
const RADIO_MARKER = '__radio_choices__'

function makeSeededApi(
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    segments?: ChatMessageSegment[]
  }>,
): AiChatClient {
  const dtos: ChatMessageDto[] = messages.map((m, i) => ({
    id: `s-${i}`,
    conversationId: SEEDED_ID,
    role: m.role,
    content: m.content,
    createdAt: new Date(
      Date.now() - (messages.length - i) * 15_000,
    ).toISOString(),
    ...(m.segments ? { segments: m.segments } : {}),
  }))
  return {
    ...mockChatApi,
    async listMessages(id) {
      await new Promise((r) => setTimeout(r, 150))
      return id === SEEDED_ID ? dtos : []
    },
  }
}

function radioRenderer(content: string): React.ReactNode {
  if (content !== RADIO_MARKER)
    return <p className="text-sm text-foreground">{content}</p>
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground">
        Which outreach strategy should we prioritize this week?
      </p>
      <RadioGroup defaultValue="" className="gap-2">
        <RadioCardItem
          value="door"
          id="door"
          title="Door-to-door canvassing"
          description="Highest conversion rate for local races"
        />
        <RadioCardItem
          value="phone"
          id="phone"
          title="Phone banking"
          description="Reach more voters in less time"
        />
        <RadioCardItem
          value="social"
          id="social"
          title="Social media blitz"
          description="Best for engaging younger voters"
        />
      </RadioGroup>
      <Button type="button" size="small" className="self-end">
        Confirm choice
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// WithRadioCards
// ---------------------------------------------------------------------------

const RADIO_API = makeSeededApi([
  { role: 'user', content: 'What outreach strategy should I focus on?' },
  { role: 'assistant', content: RADIO_MARKER },
])

export const WithRadioCards: StoryObj = {
  parameters: {
    controls: { disable: true },
    docs: { story: { inline: false, height: '600px' } },
  },
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <AiChatDemo
        open={open}
        onOpenChange={setOpen}
        chatApi={RADIO_API}
        initialConversationId={SEEDED_ID}
        messageRenderer={radioRenderer}
      />
    )
  },
}

// ---------------------------------------------------------------------------
// WithToolSegments — assistant turn that interleaves text and tool calls
// ---------------------------------------------------------------------------

const SEGMENTS_API = makeSeededApi([
  { role: 'user', content: 'How are my fundraising numbers trending?' },
  {
    role: 'assistant',
    content:
      "Let me pull your finance records.\n\nYou've raised **$47,200** of your $75,000 goal — 63%, up 18% from last month. At this pace you'll clear the goal about 9 days before the filing deadline.",
    segments: [
      { kind: 'text', text: 'Let me pull your finance records.' },
      { kind: 'tool', toolName: 'finance_lookup' },
      { kind: 'tool', toolName: 'trend_analysis' },
      {
        kind: 'text',
        text: "You've raised **$47,200** of your $75,000 goal — 63%, up 18% from last month. At this pace you'll clear the goal about 9 days before the filing deadline.",
      },
    ],
  },
])

export const WithToolSegments: StoryObj = {
  parameters: {
    controls: { disable: true },
    docs: { story: { inline: false, height: '600px' } },
  },
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <AiChatDemo
        open={open}
        onOpenChange={setOpen}
        chatApi={SEGMENTS_API}
        initialConversationId={SEEDED_ID}
        config={{
          ...DEFAULT_CONFIG,
          toolDisplayNames: {
            finance_lookup: 'Reading finance records',
            trend_analysis: 'Analyzing the trend',
          },
        }}
      />
    )
  },
}

// ---------------------------------------------------------------------------
// WithStepper
// ---------------------------------------------------------------------------

export const WithStepper: StoryObj = {
  parameters: {
    controls: { disable: true },
    docs: { story: { inline: false, height: '600px' } },
  },
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <AiChatDemo
        open={open}
        onOpenChange={setOpen}
        bottomSlot={<Stepper currentStep={2} totalSteps={4} />}
      />
    )
  },
}

// ---------------------------------------------------------------------------
// LongConversation
// ---------------------------------------------------------------------------

const LONG_CONV_API = makeSeededApi([
  { role: 'user', content: 'What should I focus on this week?' },
  {
    role: 'assistant',
    content:
      "Based on your campaign data, here are your **top 3 priorities**:\n\n1. **Voter outreach** — You're at 34% of your contact goal (1,247 of 3,600)\n2. **Fundraising** — Q3 deadline in 12 days, currently at $47,200 of $75,000\n3. **Debate prep** — Scheduled Thursday at City Hall",
  },
  { role: 'user', content: 'Tell me more about the voter outreach gap' },
  {
    role: 'assistant',
    content:
      "You need to contact **2,353 more voters** in the next 3 weeks to hit your goal. At your current pace of ~60 contacts/day you'll finish at roughly 68%.\n\nTo close the gap I'd suggest:\n- Adding a Saturday phone bank session (est. +120 contacts)\n- Activating your 14 inactive volunteers\n- Targeting precincts 7 and 12 — highest density, lowest contact rate",
  },
  { role: 'user', content: 'How bad is the fundraising situation?' },
  {
    role: 'assistant',
    content:
      "You're **$27,800 short** with 12 days left. That's about $2,317/day needed — doable but tight.\n\nYour top opportunities:\n- 8 major donors who gave last cycle haven't given yet this quarter\n- Your last fundraising email had a 22% open rate — above average\n- The donor event next Tuesday could net $8,000–$12,000 based on RSVPs",
  },
  { role: 'user', content: 'What happened at the city council housing vote?' },
  {
    role: 'assistant',
    content:
      'The council voted **6–3 in favor** of the Eastside rezoning proposal on Monday. Councilmembers Reyes, Park, and Thompson voted against.\n\nThis is relevant to your campaign because affordable housing is your #2 issue. Voters in precincts 4 and 9 — both swing areas — were closely watching this vote.',
  },
  { role: 'user', content: 'Draft a response to the housing vote' },
  {
    role: 'assistant',
    content:
      "Here's a draft statement:\n\n> \"Monday's 6–3 vote to rezone the Eastside is a step in the right direction, but we need to make sure new development actually delivers affordable units — not just market-rate housing dressed up with a few set-asides. I'll be watching the implementation closely and pushing for community benefit agreements that keep longtime residents in their neighborhoods.\"\n\nWant me to adjust the tone or length?",
  },
  { role: 'user', content: "That's good. Make it shorter for social media" },
  {
    role: 'assistant',
    content:
      'Here\'s a tighter version for social:\n\n> "The Eastside rezoning passed 6–3 — good first step. Now we need to make sure it delivers real affordable housing, not just developer profits. I\'ll be watching the implementation closely. 🏘️"\n\nUnder 280 characters, ready to post.',
  },
  { role: 'user', content: "What do I need to know for Thursday's debate?" },
  {
    role: 'assistant',
    content:
      "Thursday's debate is at **City Hall, 7 PM**. Format: 90 minutes, 3 candidates, 2-minute opening, 90-second responses.\n\nTop issues likely to come up based on recent local coverage:\n1. Housing affordability (very hot after Monday's vote)\n2. Public safety — opponent Chen has been running hard on this\n3. Infrastructure — pothole complaints up 40% this quarter\n\nI can draft talking points for any of these — just say the word.",
  },
])

export const LongConversation: StoryObj = {
  parameters: {
    controls: { disable: true },
    docs: { story: { inline: false, height: '600px' } },
  },
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <AiChatDemo
        open={open}
        onOpenChange={setOpen}
        chatApi={LONG_CONV_API}
        initialConversationId={SEEDED_ID}
      />
    )
  },
}

// ---------------------------------------------------------------------------
// WithTimeline
// ---------------------------------------------------------------------------

const HISTORY_MARKER = '__history__'

const HISTORY_ITEMS: TimelineItem[] = [
  {
    label: '1978',
    title: 'Chapter 18 created',
    description:
      'Council adopts the modern zoning code, locking in single-family on most lots.',
    quote:
      '"We want neighborhoods to be stable, not frozen, but the protections came first."',
    quoteAttribution: 'Councilor Alvarez',
    source: {
      organization: 'Maplewood City Council',
      title: 'Council minutes, 1978',
    },
  },
  {
    label: '2003',
    title: 'ADU allowance',
    description:
      'Accessory dwelling units permitted on single-family lots with owner-occupancy rule.',
    quote:
      '"This is the smallest step toward more housing we can take without rewriting the whole code."',
    quoteAttribution: 'Councilor Kim',
    source: {
      organization: 'Maplewood City Council',
      title: 'Council minutes, 2003',
    },
  },
  {
    label: '2019',
    title: 'Last amended',
    description:
      'Owner-occupancy ADU rule removed. No broader missing-middle reform attempted.',
    quote:
      '"We did not have the political room for triplexes. A future council should pick that up."',
    quoteAttribution: 'Councilor Park',
    source: {
      organization: 'Maplewood City Council',
      title: 'Council minutes, 2019',
    },
  },
]

const HISTORY_API = makeSeededApi([
  { role: 'user', content: 'Walk me through the history of Chapter 18' },
  { role: 'assistant', content: HISTORY_MARKER },
])

function timelineRenderer(content: string): React.ReactNode {
  if (content === HISTORY_MARKER) return <ChatTimeline items={HISTORY_ITEMS} />
  return <p className="text-sm text-foreground">{content}</p>
}

export const WithTimeline: StoryObj = {
  parameters: {
    controls: { disable: true },
    docs: { story: { inline: false, height: '600px' } },
  },
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <AiChatDemo
        open={open}
        onOpenChange={setOpen}
        chatApi={HISTORY_API}
        initialConversationId={SEEDED_ID}
        messageRenderer={timelineRenderer}
      />
    )
  },
}
