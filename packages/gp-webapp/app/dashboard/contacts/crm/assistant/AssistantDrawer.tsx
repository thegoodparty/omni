'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import { useOrganization } from '@shared/organization-picker'
import {
  AssistantRow,
  ChatComposer,
  InlineSegments,
  ThinkingRow,
  UserBubble,
} from '../../../shared/agent-chat/chatUI'
import { segmentsToLive } from '../../../shared/agent-chat/streaming'
import { useStreamingTurn } from '../../../shared/agent-chat/useStreamingTurn'
import {
  SAVED_FILTERS_TOOL,
  assistantToolLabel,
  type AssistantChatBinding,
} from './assistantChat'

// A bar submit starts a chat with that first message; a pick from the clock
// popover reopens that conversation. For Win the scope handler resumes the
// latest campaign_assistant conversation on "new", so history still loads.
export type AssistantRequest =
  | { kind: 'new'; initialMessage: string }
  | { kind: 'existing'; conversationId: string }

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: AssistantRequest | null
  /** Changes remount the conversation body so each request starts clean. */
  requestKey: number
  chat: AssistantChatBinding
  title: string
  subtitle: string
  /**
   * ENG-10767: called once per composer follow-up send. The initial bar
   * submit is tracked by the caller (CrmAssistant), not here — the drawer
   * only sees it as a request prop.
   */
  onMessageSent?: () => void
}

// The conversation surface: a right-side drawer streaming through the shared
// agent-chat stack. The prototype's post-submit drawer was reused ordinance
// scaffolding, not real design (design-verification comment on ENG-10737) —
// this is the mode-correct replacement.
export default function AssistantDrawer({
  open,
  onOpenChange,
  request,
  requestKey,
  chat,
  title,
  subtitle,
  onMessageSent,
}: Props): React.JSX.Element {
  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        data-testid="crm-assistant-drawer"
        className="p-0 data-[vaul-drawer-direction=right]:sm:max-w-md"
        aria-describedby={undefined}
      >
        <DrawerHeader className="flex flex-row items-center gap-2 border-b border-border p-4 pr-12">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <SparklesIcon className="size-4" aria-hidden />
          </span>
          <div className="flex flex-col text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          </div>
        </DrawerHeader>
        {request && (
          <AssistantConversation
            key={requestKey}
            request={request}
            chat={chat}
            onMessageSent={onMessageSent}
          />
        )}
      </DrawerContent>
    </Drawer>
  )
}

function AssistantConversation({
  request,
  chat,
  onMessageSent,
}: {
  request: AssistantRequest
  chat: AssistantChatBinding
  onMessageSent?: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const orgSlug = useOrganization()?.slug
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [composer, setComposer] = useState('')
  const [streamError, setStreamError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initRequestedRef = useRef(false)

  const { messages, setMessages, visibleSegments, sending, send } =
    useStreamingTurn(chat.chatApi, {
      toolLabel: assistantToolLabel,
      onTurnStart: () => setStreamError(null),
      onError: (message) => setStreamError(message),
      onEvent: (event) => {
        // A finished crud_saved_filters call may have written a saved list —
        // refresh the lists index without a reload. Keys must match
        // ContactsTableProvider (['custom-segments', orgSlug]) and
        // useListRowDetail (['list-detail', orgSlug, id]) exactly.
        if (
          event.type === 'tool_result' &&
          event.toolName === SAVED_FILTERS_TOOL
        ) {
          void queryClient.invalidateQueries({
            queryKey: ['custom-segments', orgSlug],
          })
          void queryClient.invalidateQueries({
            queryKey: ['list-detail', orgSlug],
          })
        }
        return false
      },
    })

  useEffect(() => {
    // Ref guard instead of a cancellation flag: under StrictMode the effect
    // runs twice on one mounted instance (refs preserved), and a cancel-first
    // approach would kill the only run that initializes.
    if (initRequestedRef.current) return
    initRequestedRef.current = true
    const init = async (): Promise<void> => {
      try {
        const id =
          request.kind === 'existing'
            ? request.conversationId
            : (await chat.chatApi.createConversation()).conversationId
        const history = await chat.chatApi.listMessages(id)
        setConversationId(id)
        setMessages(history)
        setPhase('ready')
        // Surface a just-created conversation in the clock popover right away.
        void queryClient.invalidateQueries({ queryKey: chat.historyKey })
        if (request.kind === 'new') void send(id, request.initialMessage)
      } catch {
        setPhase('error')
      }
    }
    void init()
  }, [request, chat, queryClient, send, setMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, visibleSegments])

  if (phase === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Something went wrong opening this chat. Close it and try again.
      </div>
    )
  }

  return (
    // vaul disables text selection and treats pointer-drags as drawer-drags;
    // select-text + data-vaul-no-drag restore copyable chat text (same fix as
    // the Chief of Staff body).
    <div className="flex min-h-0 flex-1 flex-col select-text" data-vaul-no-drag>
      <div
        data-testid="crm-assistant-conversation"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
      >
        {phase === 'loading' && messages.length === 0 && !sending && (
          <div className="text-sm text-muted-foreground">Loading chat...</div>
        )}

        {messages.map((message) =>
          message.role === 'user' ? (
            <UserBubble key={message.id}>{message.content}</UserBubble>
          ) : message.role === 'assistant' ? (
            <AssistantRow key={message.id}>
              <InlineSegments
                segments={segmentsToLive(
                  message.segments ?? [],
                  message.content ?? '',
                )}
                toolLabel={assistantToolLabel}
              />
            </AssistantRow>
          ) : null,
        )}

        {sending && (
          <AssistantRow>
            {visibleSegments.length > 0 ? (
              <InlineSegments
                segments={visibleSegments}
                toolLabel={assistantToolLabel}
              />
            ) : (
              <ThinkingRow />
            )}
          </AssistantRow>
        )}

        {streamError && (
          <p role="alert" className="text-sm text-destructive">
            {streamError}
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border px-3 py-3">
        <ChatComposer
          value={composer}
          onChange={setComposer}
          onSubmit={() => {
            if (!conversationId) return
            const text = composer
            // Mirror send()'s own empty-message guard: Enter on an empty
            // composer bypasses the send button's disabled state, and a
            // no-op send must not count as a message sent (ENG-10767).
            if (!text.trim()) return
            setComposer('')
            onMessageSent?.()
            void send(conversationId, text)
          }}
          disabled={sending || phase !== 'ready'}
          placeholder="Ask a follow-up or refine your list"
        />
      </div>
    </div>
  )
}
