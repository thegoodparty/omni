'use client'

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Button } from '../components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '../components/ui/drawer'
import { Progress } from '../components/ui/progress'
import { RadioGroup, RadioCardItem } from '../components/ui/radio-group'
import { DownloadIcon, ShareIcon, SparklesIcon } from '../components/ui/icons'
import AiChatBar from 'app/dashboard/shared/ai-chat/AiChatBar'
import AiChatBody from 'app/dashboard/shared/ai-chat/AiChatBody'
import AiChatSurface from 'app/dashboard/shared/ai-chat/AiChatSurface'
import ChatTimeline from 'app/dashboard/shared/ai-chat/ChatTimeline'
import { mockChatApi } from 'app/dashboard/shared/ai-chat/mock-chat-api'
import { CHAT_MAX_W } from 'app/dashboard/shared/ai-chat/constants'
import type { AiChatClient, AiChatConfig, ChatMessageDto } from 'app/dashboard/shared/ai-chat/types'
import type { TimelineItem } from 'app/dashboard/shared/ai-chat/ChatTimeline'

const queryClient = new QueryClient()

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
  extraBar,
  extraBarAlign,
  messageRenderer,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  config?: AiChatConfig
  chatApi?: AiChatClient
  initialConversationId?: string
  firstName?: string
  extraBar?: React.ReactNode
  extraBarAlign?: 'start' | 'center' | 'end'
  messageRenderer?: (content: string) => React.ReactNode
}) {
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId ?? null)

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
          extraBar={extraBar}
          extraBarAlign={extraBarAlign}
        />
      )}

      <AiChatSurface
        chatApi={chatApi}
        config={config}
        open={open}
        onOpenChange={onOpenChange}
        initialConversationId={conversationId}
        messageRenderer={messageRenderer}
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
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <Story />
      </QueryClientProvider>
    ),
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
  extraBarAlign: 'start' | 'center' | 'end'
  showExtraBar: boolean
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    open: false,
    firstName: 'Alex',
    subtitle: 'Your personal campaign strategist',
    extraBarAlign: 'center',
    showExtraBar: false,
  },
  argTypes: {
    open: {
      control: 'boolean',
      description: 'Whether the chat drawer is open.',
    },
    firstName: {
      control: 'text',
      description: 'Personalizes the bar placeholder greeting.',
    },
    subtitle: {
      control: 'text',
      description: 'Subtitle shown under the drawer title.',
    },
    extraBarAlign: {
      control: 'inline-radio',
      options: ['start', 'center', 'end'],
      description: 'Horizontal alignment of the optional extra bar content.',
    },
    showExtraBar: {
      control: 'boolean',
      description: 'Renders a Download button in the extraBar slot.',
    },
  },
  render: ({ open, firstName, subtitle, extraBarAlign, showExtraBar }) => {
    const [, updateArgs] = useArgs()
    const config = { ...DEFAULT_CONFIG, subtitle }
    const extraBar = showExtraBar ? (
      <Button
        type="button"
        variant="ghost"
        size="small"
        icon={<DownloadIcon className="size-4" />}
      >
        Download
      </Button>
    ) : undefined

    return (
      <AiChatDemo
        open={open}
        onOpenChange={(v) => updateArgs({ open: v })}
        config={config}
        firstName={firstName}
        extraBar={extraBar}
        extraBarAlign={extraBarAlign}
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
    return (
      <AiChatDemo
        open={open}
        onOpenChange={setOpen}
        firstName="Alex"
      />
    )
  },
}

export const ExtraBarSlot: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => {
    const [open, setOpen] = useState(false)
    const extraBar = (
      <Button
        type="button"
        variant="ghost"
        size="small"
        icon={<DownloadIcon className="size-4" />}
      >
        Download
      </Button>
    )
    return (
      <AiChatDemo
        open={open}
        onOpenChange={setOpen}
        extraBar={extraBar}
        extraBarAlign="center"
      />
    )
  },
}

export const ExtraBarActions: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => {
    const [open, setOpen] = useState(false)
    const extraBar = (
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="small" icon={<ShareIcon className="size-4" />}>
          Share
        </Button>
        <Button type="button" variant="ghost" size="small" icon={<DownloadIcon className="size-4" />}>
          Download
        </Button>
      </div>
    )
    return (
      <AiChatDemo
        open={open}
        onOpenChange={setOpen}
        extraBar={extraBar}
        extraBarAlign="end"
      />
    )
  },
}


export const DrawerOpen: StoryObj = {
  parameters: { controls: { disable: true }, docs: { story: { inline: false, height: '600px' } } },
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <AiChatDemo
        open={open}
        onOpenChange={setOpen}
        firstName="Jordan"
      />
    )
  },
}

export const CustomMessageRenderer: StoryObj = {
  parameters: { controls: { disable: true }, docs: { story: { inline: false, height: '600px' } } },
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
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): AiChatClient {
  const dtos: ChatMessageDto[] = messages.map((m, i) => ({
    id: `s-${i}`,
    conversationId: SEEDED_ID,
    role: m.role,
    content: m.content,
    createdAt: new Date(Date.now() - (messages.length - i) * 15_000).toISOString(),
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
  if (content !== RADIO_MARKER) return <p className="text-sm text-foreground">{content}</p>
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
      <Button type="button" size="small" className="w-fit">
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
  parameters: { controls: { disable: true }, docs: { story: { inline: false, height: '600px' } } },
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <div className="h-full min-h-[600px] bg-background">
        <AiChatSurface
          chatApi={RADIO_API}
          config={DEFAULT_CONFIG}
          open={open}
          onOpenChange={setOpen}
          initialConversationId={SEEDED_ID}
          messageRenderer={radioRenderer}
        />
      </div>
    )
  },
}

// ---------------------------------------------------------------------------
// WithProgressBar
// ---------------------------------------------------------------------------

export const WithProgressBar: StoryObj = {
  parameters: { controls: { disable: true }, docs: { story: { inline: false, height: '600px' } } },
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <div className="h-full min-h-[600px] bg-background">
        {!open && (
          <AiChatBar
            chatApi={mockChatApi}
            config={DEFAULT_CONFIG}
            onOpen={() => setOpen(true)}
            onOpenConversation={() => setOpen(true)}
          />
        )}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="flex h-[90vh] flex-col p-0" aria-describedby={undefined}>
            <DrawerHeader className="flex flex-row items-center gap-2 border-b border-border p-4 pr-12">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <SparklesIcon className="size-5" aria-hidden />
              </span>
              <div className="flex flex-col text-left">
                <DrawerTitle>{DEFAULT_CONFIG.title}</DrawerTitle>
                <span className="text-xs text-muted-foreground">{DEFAULT_CONFIG.subtitle}</span>
              </div>
            </DrawerHeader>
            <AiChatBody
              chatApi={mockChatApi}
              config={DEFAULT_CONFIG}
              active={open}
              className={`mx-auto flex min-h-0 w-full ${CHAT_MAX_W} flex-1 flex-col gap-3 overflow-y-auto px-4 py-3`}
              bottomSlot={
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Campaign setup</span>
                    <span>65%</span>
                  </div>
                  <Progress value={65} className="h-1.5" />
                </div>
              }
            />
          </DrawerContent>
        </Drawer>
      </div>
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
      "The council voted **6–3 in favor** of the Eastside rezoning proposal on Monday. Councilmembers Reyes, Park, and Thompson voted against.\n\nThis is relevant to your campaign because affordable housing is your #2 issue. Voters in precincts 4 and 9 — both swing areas — were closely watching this vote.",
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
      "Here's a tighter version for social:\n\n> \"The Eastside rezoning passed 6–3 — good first step. Now we need to make sure it delivers real affordable housing, not just developer profits. I'll be watching the implementation closely. 🏘️\"\n\nUnder 280 characters, ready to post.",
  },
  { role: 'user', content: "What do I need to know for Thursday's debate?" },
  {
    role: 'assistant',
    content:
      "Thursday's debate is at **City Hall, 7 PM**. Format: 90 minutes, 3 candidates, 2-minute opening, 90-second responses.\n\nTop issues likely to come up based on recent local coverage:\n1. Housing affordability (very hot after Monday's vote)\n2. Public safety — opponent Chen has been running hard on this\n3. Infrastructure — pothole complaints up 40% this quarter\n\nI can draft talking points for any of these — just say the word.",
  },
])

export const LongConversation: StoryObj = {
  parameters: { controls: { disable: true }, docs: { story: { inline: false, height: '600px' } } },
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <div className="h-full min-h-[600px] bg-background">
        <AiChatSurface
          chatApi={LONG_CONV_API}
          config={DEFAULT_CONFIG}
          open={open}
          onOpenChange={setOpen}
          initialConversationId={SEEDED_ID}
        />
      </div>
    )
  },
}

// ---------------------------------------------------------------------------
// WithTimeline
// ---------------------------------------------------------------------------

const TIMELINE_MARKER = '__timeline__'

const TIMELINE_ITEMS: TimelineItem[] = [
  {
    label: 'Step 1',
    title: 'File your candidacy paperwork',
    description:
      'Submit your declaration of candidacy to the county elections office. Bring a valid ID and the $150 filing fee. Deadline is 90 days before the primary.',
    source: 'County Elections Office — Filing Guide 2024',
  },
  {
    label: 'Step 2',
    title: 'Collect voter signatures',
    description:
      'Gather 250 valid signatures from registered voters in your district. Only residents of District 7 qualify. Signatures must be collected in person.',
  },
  {
    label: 'Step 3',
    title: 'Set up your campaign committee',
    description:
      'Register a campaign committee with the state ethics board before accepting any donations or spending any money. This can be done online in about 20 minutes.',
    source: 'State Ethics Board — Campaign Finance FAQ',
  },
  {
    label: 'Step 4',
    title: 'Launch your GoodParty campaign page',
    description:
      'Activate your free candidate profile so supporters can find you, donate, and volunteer. Your profile goes live immediately after setup.',
  },
  {
    label: 'Step 5',
    title: 'File your first financial disclosure',
    description:
      'Report all donations and expenditures within 30 days of your committee registration. Late filings result in a $50/day penalty.',
    source: 'State Ethics Board — Disclosure Calendar',
  },
]

const TIMELINE_API = makeSeededApi([
  { role: 'user', content: 'Walk me through the history of Chapter 18' },
  { role: 'assistant', content: TIMELINE_MARKER },
])

function timelineRenderer(content: string): React.ReactNode {
  if (content !== TIMELINE_MARKER) return <p className="text-sm text-foreground">{content}</p>
  return <ChatTimeline items={TIMELINE_ITEMS} />
}

export const WithTimeline: StoryObj = {
  parameters: { controls: { disable: true }, docs: { story: { inline: false, height: '600px' } } },
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <div className="h-full min-h-[600px] bg-background">
        <AiChatSurface
          chatApi={TIMELINE_API}
          config={DEFAULT_CONFIG}
          open={open}
          onOpenChange={setOpen}
          initialConversationId={SEEDED_ID}
          messageRenderer={timelineRenderer}
        />
      </div>
    )
  },
}
