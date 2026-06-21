'use client'

import { IconButton } from '@styleguide'
import { MicIcon, SparklesIcon } from '@styleguide/components/ui/icons'
import { CHAT_MAX_W } from './constants'
import AiChatHistoryPopover from './AiChatHistoryPopover'
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
}

/**
 * Persistent footer chat bar. Fixed to the bottom of the viewport, offset by
 * the sidebar (16rem) on lg+. Tapping the pill or any button opens the chat
 * surface.
 */
export default function AiChatBar({
  chatApi,
  config,
  firstName,
  onOpen,
  onOpenConversation,
  extraBar,
  extraBarAlign = 'center',
}: Props): React.JSX.Element {
  const placeholder = firstName
    ? `Hi, ${firstName}, how can I help?`
    : (config.placeholder ?? 'How can I help?')

  return (
    <div className="fixed inset-x-0 bottom-0 z-[55] lg:left-64">
      {extraBar && (
        <div className="flex h-14 w-full items-center border-t border-b border-border bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80">
          <div className={`mx-auto flex w-full ${CHAT_MAX_W} items-center px-4 lg:px-6 ${extraBarAlign === 'start' ? 'justify-start' : extraBarAlign === 'end' ? 'justify-end' : 'justify-center'}`}>
            {extraBar}
          </div>
        </div>
      )}
      <div className={`bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80 ${!extraBar ? 'border-t border-border' : ''}`}>
      <div className={`mx-auto flex w-full ${CHAT_MAX_W} items-center px-4 py-4 lg:px-6`}>
        <div
          className="relative w-full rounded-full p-px animate-spin-gradient"
          style={{ background: 'conic-gradient(from var(--gradient-angle), var(--ai-gradient-from), var(--ai-gradient-to), var(--ai-gradient-from))' }}
        >
          <div className="flex min-h-12 w-full items-center gap-1 rounded-full bg-card py-1.5 pl-1.5 pr-1.5">
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
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
