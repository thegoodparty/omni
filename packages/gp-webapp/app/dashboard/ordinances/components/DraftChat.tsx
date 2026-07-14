'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { IconButton, Input } from '@styleguide'
import { SendIcon } from '@styleguide/components/ui/icons'
import type { ChatAnchor, Ordinance } from '@goodparty_org/contracts'
import { AssistantRow, InlineSegments } from '../../shared/agent-chat/chatUI'
import { segmentsToLive } from '../../shared/agent-chat/streaming'
import { useStreamingTurn } from '../../shared/agent-chat/useStreamingTurn'
import { ordinanceFlowChatApi } from '../data/chat-api'
import { ordinanceToolLabel } from '../data/toolLabels'

export type DraftChatHandle = { seed: (composerText: string) => void }

// A slim chat about the draft: the ordinance_flow conversation anchored to the
// draft step. Streaming, reveal, and the turn loop come from the shared
// useStreamingTurn driver; this component only adds the composer, the seed()
// handle, and history rendering. Exposes seed(text) so the draft editor's
// highlight toolbar can prefill the composer with a question about a passage.
const DraftChat = forwardRef<DraftChatHandle, { ordinance: Ordinance }>(
  function DraftChat({ ordinance }, ref): React.JSX.Element {
    const [conversationId, setConversationId] = useState<string | null>(null)
    const [composer, setComposer] = useState('')
    const bottomRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const { messages, setMessages, visibleSegments, sending, send } =
      useStreamingTurn(ordinanceFlowChatApi, { toolLabel: ordinanceToolLabel })

    useEffect(() => {
      let cancelled = false
      const init = async (): Promise<void> => {
        const anchor: ChatAnchor = {
          resourceType: 'ordinance',
          resourceId: ordinance.id,
          url: `/dashboard/ordinances/draft/${ordinance.slug}`,
          snapshot: {
            title:
              ordinance.draftTitle ??
              ordinance.goalText ??
              'Untitled ordinance',
            summary: ordinance.goalText ?? '',
          },
          step: 'draft',
        }
        try {
          const { conversationId: id } =
            await ordinanceFlowChatApi.createConversation(anchor)
          const history = await ordinanceFlowChatApi.listMessages(id)
          if (cancelled) return
          setConversationId(id)
          setMessages(history)
        } catch {
          // Leave the chat empty; the composer stays disabled until it resolves.
        }
      }
      void init()
      return () => {
        cancelled = true
      }
    }, [
      ordinance.id,
      ordinance.slug,
      ordinance.draftTitle,
      ordinance.goalText,
      setMessages,
    ])

    useImperativeHandle(
      ref,
      () => ({
        seed: (composerText: string): void => {
          setComposer(composerText)
          inputRef.current?.focus()
        },
      }),
      [],
    )

    useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, visibleSegments])

    const working = sending && visibleSegments.length === 0

    // Project persisted assistant turns once per history change, not on every
    // reveal tick (useSmoothReveal re-renders this component every 24ms while a
    // turn streams).
    const history = useMemo(
      () =>
        messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          live:
            m.role === 'user'
              ? null
              : segmentsToLive(m.segments ?? [], m.content),
        })),
      [messages],
    )

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {history.map((m) =>
            m.live === null ? (
              <div
                key={m.id}
                className="self-end rounded-2xl bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
              >
                {m.content}
              </div>
            ) : (
              <AssistantRow key={m.id}>
                <InlineSegments
                  segments={m.live}
                  toolLabel={ordinanceToolLabel}
                />
              </AssistantRow>
            ),
          )}

          {visibleSegments.length > 0 ? (
            <AssistantRow>
              <InlineSegments
                segments={visibleSegments}
                toolLabel={ordinanceToolLabel}
              />
            </AssistantRow>
          ) : null}

          {working ? (
            <div className="w-fit self-start rounded-2xl bg-muted px-3 py-2 text-sm">
              <span className="text-shimmer-muted">Thinking...</span>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>

        <form
          className="flex items-center gap-1 rounded-full border border-border bg-card py-1 pr-1 pl-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!conversationId) return
            const text = composer
            setComposer('')
            void send(conversationId, text)
          }}
        >
          <Input
            ref={inputRef}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            placeholder="Ask me any questions about this..."
            disabled={sending || !conversationId}
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <IconButton
            type="submit"
            className="rounded-full"
            disabled={sending || composer.trim().length === 0}
            aria-label="Send"
          >
            <SendIcon className="size-4" aria-hidden />
          </IconButton>
        </form>
      </div>
    )
  },
)

export default DraftChat
