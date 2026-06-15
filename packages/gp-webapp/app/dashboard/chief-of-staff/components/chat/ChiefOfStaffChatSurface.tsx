'use client'

import { useCallback, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  IconButton,
} from '@styleguide'
import {
  ArrowLeftIcon,
  ClockIcon,
  SparklesIcon,
  Trash2Icon,
} from '@styleguide/components/ui/icons'
import {
  useChatHistory,
  useDeleteConversation,
} from '../../data/use-chat-history'
import ChiefOfStaffChatBody from './ChiefOfStaffChatBody'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type View =
  | { mode: 'new' }
  | { mode: 'history' }
  | { mode: 'conversation'; conversationId: string }

function conversationLabel(title: string | null, createdAt: string): string {
  if (title && title.trim()) return title
  try {
    return `Chat from ${format(parseISO(createdAt), 'MMM d, h:mm a')}`
  } catch {
    return 'Untitled chat'
  }
}

/**
 * The Chief of Staff chat surface — a bottom drawer (rising from the footer
 * chat bar) that hosts the reusable chat body, a history list (the clock
 * icon), and per-conversation delete. New chats defer creation until the first
 * message.
 */
export default function ChiefOfStaffChatSurface({
  open,
  onOpenChange,
}: Props): React.JSX.Element {
  const [view, setView] = useState<View>({ mode: 'new' })

  const showingHistory = view.mode === 'history'
  const { data: conversations, isPending } = useChatHistory(
    open && showingHistory,
  )
  const deleteConversation = useDeleteConversation()

  const openHistory = useCallback(() => setView({ mode: 'history' }), [])
  const openNew = useCallback(() => setView({ mode: 'new' }), [])

  const handleDelete = useCallback(
    (id: string) => {
      deleteConversation.mutate(id)
    },
    [deleteConversation],
  )

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="flex h-[80vh] flex-col p-0"
        aria-describedby={undefined}
      >
        <DrawerHeader className="flex flex-row items-center gap-2 border-b border-border p-4 pr-12">
          {view.mode === 'history' ? (
            <IconButton
              type="button"
              size="small"
              variant="ghost"
              aria-label="Back to chat"
              onClick={openNew}
            >
              <ArrowLeftIcon className="size-4" aria-hidden />
            </IconButton>
          ) : (
            <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
              <SparklesIcon className="size-4" aria-hidden />
            </span>
          )}
          <DrawerTitle className="flex-1">
            {view.mode === 'history' ? 'Chat history' : 'Chief of Staff'}
          </DrawerTitle>
          {view.mode !== 'history' && (
            <IconButton
              type="button"
              size="small"
              variant="ghost"
              aria-label="Chat history"
              onClick={openHistory}
            >
              <ClockIcon className="size-4" aria-hidden />
            </IconButton>
          )}
        </DrawerHeader>

        {view.mode === 'history' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            {isPending ? (
              <p className="p-3 text-sm text-muted-foreground">Loading...</p>
            ) : !conversations || conversations.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No past conversations yet.
              </p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setView({ mode: 'conversation', conversationId: c.id })
                    }
                    className="flex-1 truncate py-1.5 text-left text-sm text-foreground"
                  >
                    {conversationLabel(c.title, c.createdAt)}
                  </button>
                  <IconButton
                    type="button"
                    size="small"
                    variant="ghost"
                    aria-label="Delete chat"
                    onClick={() => handleDelete(c.id)}
                    disabled={deleteConversation.isPending}
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                  </IconButton>
                </div>
              ))
            )}
          </div>
        ) : (
          <ChiefOfStaffChatBody
            // Remount on view switch so a fresh body picks up the right
            // conversation (or a clean deferred-create state for `new`).
            key={view.mode === 'conversation' ? view.conversationId : 'new'}
            active={open}
            conversationIdOverride={
              view.mode === 'conversation' ? view.conversationId : undefined
            }
            bodyClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
          />
        )}
      </DrawerContent>
    </Drawer>
  )
}
