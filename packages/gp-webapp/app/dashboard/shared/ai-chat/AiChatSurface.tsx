'use client'

import { useEffect, useState } from 'react'
import {
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
} from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import AiChatBody from './AiChatBody'
import { CHAT_MAX_W } from './constants'
import type { AiChatClient, AiChatConfig } from './types'

interface Props {
  chatApi: AiChatClient
  config: AiChatConfig
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, open directly into this conversation (from footer history popover). */
  initialConversationId?: string | null
  /** Custom renderer for assistant message content. Defaults to ReactMarkdown. */
  messageRenderer?: (content: string) => React.ReactNode
  /** Portal target for the drawer. Defaults to document.body. */
  container?: HTMLElement | null
  /** Optional slot rendered between the message list and the input. */
  bottomSlot?: React.ReactNode
}

/**
 * Generic AI assistant chat surface — a bottom Drawer hosting AiChatBody.
 * Configurable per surface (Chief of Staff, AI Campaign Manager, etc.) via
 * the `config` prop. Conversation history lives in the input pill's clock
 * popover (AiChatHistoryPopover); picking a conversation there swaps the
 * active one here.
 */
export default function AiChatSurface({
  chatApi,
  config,
  open,
  onOpenChange,
  initialConversationId,
  messageRenderer,
  container,
  bottomSlot,
}: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialConversationId ?? null,
  )

  useEffect(() => {
    if (open) setSelectedId(initialConversationId ?? null)
  }, [open, initialConversationId])

  return (
    <Drawer open={open} onOpenChange={onOpenChange} container={container}>
      <DrawerContent
        className="flex h-[90vh] flex-col p-0"
        aria-describedby={undefined}
      >
        {/* TODO(design): the drawer's built-in close button (styleguide
            DrawerContent) can't be restyled or repositioned per surface. To
            address Kylie's review (hover like the mic, slightly larger, aligned
            inline with the title), add a `hideClose` prop to the shared Drawer,
            then render a custom DrawerClose IconButton in the header here. */}
        <DrawerHandle className="mb-1" />
        <DrawerHeader className="flex flex-row items-center gap-3 border-b border-border px-4 py-3 pr-12">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-primary-foreground"
            style={{
              background:
                'linear-gradient(135deg, var(--ai-gradient-from), var(--ai-gradient-to))',
            }}
          >
            <SparklesIcon className="size-4" aria-hidden />
          </span>
          <div className="flex flex-col text-left">
            <DrawerTitle className="text-base font-semibold">
              {config.title}
            </DrawerTitle>
            {config.subtitle && (
              <span className="text-sm text-muted-foreground">
                {config.subtitle}
              </span>
            )}
          </div>
        </DrawerHeader>

        <AiChatBody
          // Remount on conversation switch so the body picks up the right state.
          key={selectedId ?? 'new'}
          chatApi={chatApi}
          config={config}
          active={open}
          conversationIdOverride={selectedId ?? undefined}
          className={`mx-auto flex min-h-0 w-full ${CHAT_MAX_W} flex-1 flex-col gap-10 overflow-y-auto px-4 py-5`}
          messageRenderer={messageRenderer}
          bottomSlot={bottomSlot}
        />
      </DrawerContent>
    </Drawer>
  )
}
