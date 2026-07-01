'use client'

import { IconButton } from '@styleguide'
import { MicIcon, SparklesIcon } from '@styleguide/components/ui/icons'
import ChatHistoryPopover from './ChatHistoryPopover'
import type { ManagerChatClient } from '../../../shared/manager-chat/chatClient'

interface Props {
  firstName?: string
  /** Open the chat surface (new conversation). */
  onOpen: () => void
  /** Open the chat surface into a past conversation (from the clock popover). */
  onOpenConversation: (conversationId: string) => void
  /** Chat client for this scope's history popover. Defaults to Chief of Staff. */
  chatApi?: ManagerChatClient
  /** History query key for this scope. Defaults to Chief of Staff. */
  historyKey?: readonly unknown[]
  /** aria-label for the open button. Defaults to Chief of Staff. */
  openLabel?: string
}

/**
 * Persistent footer chat bar. Fixed to the bottom at all widths and offset by
 * the dashboard sidebar (16rem) on lg+ — the breakpoint where the sidebar
 * rail appears (below lg it collapses to a mobile sheet, so the bar spans the
 * full width). Tapping the pill (or any of its buttons) opens the chat
 * surface.
 */
export default function FooterChatBar({
  firstName,
  onOpen,
  onOpenConversation,
  chatApi,
  historyKey,
  openLabel = 'Open Chief of Staff chat',
}: Props): React.JSX.Element {
  const placeholder = firstName
    ? `Hi, ${firstName}, how can I help?`
    : 'How can I help?'

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80 lg:left-64">
      <div className="mx-auto flex w-full max-w-[608px] items-center px-4 py-4 lg:px-6">
        <div className="relative w-full rounded-full bg-gradient-to-r from-red-500 to-blue-500 p-px">
          <div className="flex h-12 w-full items-center gap-1 rounded-full bg-card pl-1.5 pr-1.5">
            <ChatHistoryPopover
              onSelect={onOpenConversation}
              chatApi={chatApi}
              historyKey={historyKey}
            />
            <button
              type="button"
              onClick={onOpen}
              className="flex-1 truncate text-left text-[15px] font-medium text-muted-foreground"
            >
              {placeholder}
            </button>
            <IconButton
              type="button"
              size="small"
              variant="ghost"
              aria-label="Dictate a message"
              className="size-10"
              onClick={onOpen}
            >
              <MicIcon className="size-5" aria-hidden />
            </IconButton>
            <IconButton
              type="button"
              size="small"
              aria-label={openLabel}
              className="size-10 bg-primary text-primary-foreground"
              onClick={onOpen}
            >
              <SparklesIcon className="size-5" aria-hidden />
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  )
}
