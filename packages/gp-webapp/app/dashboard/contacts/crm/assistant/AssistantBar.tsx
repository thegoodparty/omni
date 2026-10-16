'use client'

import { useRef, useState } from 'react'
import { IconButton, Input } from '@styleguide'
import {
  MicIcon,
  PaperclipIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import ChatHistoryPopover from '../../../chief-of-staff/components/chat/ChatHistoryPopover'
import {
  ASSISTANT_PLACEHOLDER,
  type AssistantChatBinding,
} from './assistantChat'

interface Props {
  // Only the history popover's two fields: the bar reads no more of the
  // binding than that, and its tests shouldn't have to stub the rest.
  chat: Pick<AssistantChatBinding, 'chatApi' | 'historyKey'>
  /** Open the conversation drawer with this first message. */
  onSubmit: (message: string) => void
  /** Reopen a past conversation picked from the clock popover. */
  onOpenConversation: (conversationId: string) => void
  /** Open a fresh conversation drawer (the mic). */
  onOpen: () => void
  /** Open a fresh conversation drawer with this file attached. */
  onAttachFile: (file: File) => void
}

// The persistent assistant pill pinned to the bottom of the contacts surface.
// Mirrors the Chief of Staff FooterChatBar's placement and gradient pill
// (fixed bottom, offset by the sidebar rail on lg+) and toolbar, but carries a
// real input so the first message is typed here.
export default function AssistantBar({
  chat,
  onSubmit,
  onOpenConversation,
  onOpen,
  onAttachFile,
}: Props): React.JSX.Element {
  const [value, setValue] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

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
              type="button"
              size="small"
              variant="ghost"
              aria-label="Attach a file"
              className="size-10 shrink-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon className="size-5" aria-hidden />
            </IconButton>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,image/jpeg,image/png"
              className="hidden"
              aria-hidden
              tabIndex={-1}
              data-testid="crm-assistant-file-input"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) onAttachFile(file)
              }}
            />
            <IconButton
              type="button"
              size="small"
              variant="ghost"
              aria-label="Dictate a message"
              className="size-10 shrink-0"
              onClick={onOpen}
            >
              <MicIcon className="size-5" aria-hidden />
            </IconButton>
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
