'use client'

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Button } from '../components/ui/button'
import { DownloadIcon } from '../components/ui/icons'
import AiChatBar from 'app/dashboard/shared/ai-chat/AiChatBar'
import AiChatSurface from 'app/dashboard/shared/ai-chat/AiChatSurface'
import { mockChatApi } from 'app/dashboard/shared/ai-chat/mock-chat-api'
import type { AiChatConfig } from 'app/dashboard/shared/ai-chat/types'

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
  firstName,
  extraBar,
  extraBarAlign,
  messageRenderer,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  config?: AiChatConfig
  firstName?: string
  extraBar?: React.ReactNode
  extraBarAlign?: 'start' | 'center' | 'end'
  messageRenderer?: (content: string) => React.ReactNode
}) {
  const [conversationId, setConversationId] = useState<string | null>(null)

  return (
    <div className="relative h-[500px] overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Page content area
      </div>

      {!open && (
        <AiChatBar
          chatApi={mockChatApi}
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
        chatApi={mockChatApi}
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
const meta: Meta = {
  title: 'Patterns/AiChat',
  tags: ['autodocs'],
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

export const BarWithExtraBar: StoryObj = {
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

export const DrawerOpen: StoryObj = {
  parameters: { controls: { disable: true } },
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
  parameters: { controls: { disable: true } },
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
