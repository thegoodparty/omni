'use client'

import { useState } from 'react'
import { IconButton, Input } from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import ChatHistoryPopover from '../../../chief-of-staff/components/chat/ChatHistoryPopover'
import {
  ASSISTANT_PLACEHOLDER,
  type AssistantChatBinding,
} from './assistantChat'

interface Props {
  chat: AssistantChatBinding
  /** Open the conversation drawer with this first message. */
  onSubmit: (message: string) => void
  /** Reopen a past conversation picked from the clock popover. */
  onOpenConversation: (conversationId: string) => void
}

// The persistent assistant pill pinned to the bottom of the contacts surface.
// Mirrors the Chief of Staff FooterChatBar's placement and gradient pill
// (fixed bottom, offset by the sidebar rail on lg+), but carries a real input
// so the first message is typed here, and no mic — the epic ships text-only.
export default function AssistantBar({
  chat,
  onSubmit,
  onOpenConversation,
}: Props): React.JSX.Element {
  const [value, setValue] = useState('')

  return (
    <div
      data-testid="crm-assistant-bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80 lg:left-64"
    >
      <div className="mx-auto flex w-full max-w-[608px] items-center px-4 py-4 lg:px-6">
        <div className="relative w-full rounded-full bg-gradient-to-r from-red-500 to-blue-500 p-px">
          <form
            className="flex h-12 w-full items-center gap-1 rounded-full bg-card pr-1.5 pl-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              const trimmed = value.trim()
              if (!trimmed) return
              setValue('')
              onSubmit(trimmed)
            }}
          >
            <ChatHistoryPopover
              onSelect={onOpenConversation}
              chatApi={chat.chatApi}
              historyKey={chat.historyKey}
            />
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={ASSISTANT_PLACEHOLDER}
              aria-label={ASSISTANT_PLACEHOLDER}
              data-testid="crm-assistant-input"
              className="h-9 flex-1 border-0 bg-transparent px-2 text-[15px] shadow-none focus-visible:border-0 focus-visible:ring-0"
            />
            <IconButton
              type="submit"
              size="small"
              aria-label="Ask the assistant"
              className="size-10 shrink-0 rounded-full bg-primary text-primary-foreground"
              disabled={value.trim().length === 0}
            >
              <SparklesIcon className="size-5" aria-hidden />
            </IconButton>
          </form>
        </div>
      </div>
    </div>
  )
}
