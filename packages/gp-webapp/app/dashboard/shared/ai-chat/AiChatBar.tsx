'use client'

import { IconButton } from '@styleguide'
import { MicIcon, SparklesIcon } from '@styleguide/components/ui/icons'
import { CHAT_MAX_W } from './constants'
import AiChatHistoryPopover from './AiChatHistoryPopover'
import ChatPill from './ChatPill'
import type { AiChatClient, AiChatConfig } from './types'

interface Props {
  chatApi: AiChatClient
  config: AiChatConfig
  firstName?: string
  /** Open the chat surface (new conversation). */
  onOpen: () => void
  /** Open the chat surface into a past conversation (from the history popover). */
  onOpenConversation: (conversationId: string) => void
  /** Optional content rendered in a bar above the chat input. */
  extraBar?: React.ReactNode
  /** Horizontal alignment of extraBar content. Default: center. */
  extraBarAlign?: 'start' | 'center' | 'end'
  /** Extra classes on the fixed container — use to offset for a sidebar, e.g. `lg:left-64`. */
  className?: string
}

/**
 * Persistent footer chat bar. Fixed to the bottom of the viewport, offset by
 * the sidebar (16rem) on lg+. Tapping the pill or any button opens the chat
 * surface.
 *
 * Because it is `position: fixed`, it does not reserve layout space. The host
 * page must pad its own bottom so content is not hidden behind the bar:
 * roughly `pb-[72px]` for the pill row alone, `pb-[120px]` when `extraBar` is
 * set (48px extra bar + 72px pill row).
 */
export default function AiChatBar({
  chatApi,
  config,
  firstName,
  onOpen,
  onOpenConversation,
  extraBar,
  extraBarAlign = 'center',
  className,
}: Props): React.JSX.Element {
  const placeholder = firstName
    ? `Hi, ${firstName}, how can I help?`
    : (config.placeholder ?? 'How can I help?')

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-[55]${className ? ` ${className}` : ''}`}
    >
      {extraBar && (
        <div className="flex h-12 w-full items-center border-t border-b border-border bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80">
          <div
            className={`mx-auto flex w-full ${CHAT_MAX_W} items-center px-4 lg:px-6 ${extraBarAlign === 'start' ? 'justify-start' : extraBarAlign === 'end' ? 'justify-end' : 'justify-center'}`}
          >
            {extraBar}
          </div>
        </div>
      )}
      <div
        className={`bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80 ${!extraBar ? 'border-t border-border' : ''}`}
      >
        <div
          className={`mx-auto flex w-full ${CHAT_MAX_W} items-center gap-2 px-4 py-3 lg:px-6`}
        >
          <ChatPill className="min-w-0 flex-1" innerClassName="items-center">
            <AiChatHistoryPopover
              chatApi={chatApi}
              configTitle={config.title}
              onSelect={onOpenConversation}
            />
            <button
              type="button"
              onClick={onOpen}
              className="flex-1 truncate text-left text-sm font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:ring-offset-2 rounded-full"
            >
              {placeholder}
            </button>
            <IconButton
              type="button"
              size="medium"
              variant="ghost"
              aria-label="Dictate a message"
              onClick={onOpen}
            >
              <MicIcon className="size-5" aria-hidden />
            </IconButton>
            <IconButton
              type="button"
              size="medium"
              aria-label={`Open ${config.title} chat`}
              className="bg-primary text-primary-foreground"
              onClick={onOpen}
            >
              <SparklesIcon className="size-4" aria-hidden />
            </IconButton>
          </ChatPill>
        </div>
      </div>
    </div>
  )
}
