'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { IconButton, Popover, PopoverContent, PopoverTrigger } from '@styleguide'
import { ClockIcon, Trash2Icon } from '@styleguide/components/ui/icons'
import { useAiChatHistory, useDeleteAiConversation } from './useAiChatHistory'
import type { AiChatClient } from './types'

interface Props {
  chatApi: AiChatClient
  configTitle: string
  onSelect: (conversationId: string) => void
}

function label(title: string | null, createdAt: string): string {
  if (title && title.trim()) return title
  try {
    return `Chat from ${format(parseISO(createdAt), 'MMM d, h:mm a')}`
  } catch {
    return 'Untitled chat'
  }
}

export default function AiChatHistoryPopover({ chatApi, configTitle, onSelect }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { data: conversations, isPending, isFetching } = useAiChatHistory(chatApi, configTitle, open)
  const deleteConversation = useDeleteAiConversation(chatApi, configTitle)
  const hasConversations = !!conversations && conversations.length > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          type="button"
          size="medium"
          variant="ghost"
          aria-label="Previous conversations"
          className="shrink-0"
        >
          <ClockIcon className="size-5" aria-hidden />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-2">
        <p className="px-2 py-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Previous conversations
        </p>
        {hasConversations ? (
          <div className="flex max-h-72 flex-col overflow-y-auto">
            {conversations.map((c) => (
              <div
                key={c.conversationId}
                className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onSelect(c.conversationId)
                  }}
                  className="flex-1 truncate py-1 text-left text-sm text-foreground"
                >
                  {label(c.title, c.createdAt)}
                </button>
                <IconButton
                  type="button"
                  size="small"
                  variant="ghost"
                  aria-label="Delete chat"
                  onClick={() => deleteConversation.mutate(c.conversationId)}
                  disabled={deleteConversation.isPending}
                >
                  <Trash2Icon aria-hidden />
                </IconButton>
              </div>
            ))}
          </div>
        ) : isPending || isFetching ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">Loading...</p>
        ) : (
          <p className="px-2 py-2 text-sm text-muted-foreground">No past conversations yet.</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
