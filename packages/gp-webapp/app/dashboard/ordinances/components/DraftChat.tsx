'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { IconButton, Input } from '@styleguide'
import { SendIcon } from '@styleguide/components/ui/icons'
import type { ChatAnchor, Ordinance } from '@goodparty_org/contracts'
import type {
  ChatMessageDto,
  ChatMessageSegment,
} from '../../shared/agent-chat/chatClient'
import { AssistantRow, InlineSegments } from '../../shared/agent-chat/chatUI'
import {
  segmentsTextLength,
  useSmoothReveal,
  type LiveSegment,
} from '../../shared/agent-chat/streaming'
import { ordinanceFlowChatApi } from '../data/chat-api'

// Tools that surface as a running pill; bookkeeping tools stay hidden.
const TOOL_LABELS: Record<string, string> = {
  web_search: 'Searching the web',
  read_ordinance: 'Reviewing your ordinance',
  get_code_source: 'Checking the current code',
  fetch_url: 'Reading the municipal code',
}
const REVEAL_DRAIN_POLL_MS = 40
const REVEAL_DRAIN_MAX_TICKS = 250

export type DraftChatHandle = { seed: (composerText: string) => void }

// Persisted assistant segments -> the shared inline-segment model.
const toLive = (
  segments: ChatMessageSegment[],
  content: string,
): LiveSegment[] =>
  segments.length > 0
    ? segments.flatMap((s) =>
        s.kind === 'text'
          ? s.text
            ? [{ kind: 'text', text: s.text } as LiveSegment]
            : []
          : s.toolName
            ? [{ kind: 'tool', toolName: s.toolName } as LiveSegment]
            : [],
      )
    : content
      ? [{ kind: 'text', text: content }]
      : []

const toolLabel = (name: string): string | null => TOOL_LABELS[name] ?? null

// A slim chat about the draft: the ordinance_flow conversation anchored to the
// draft step, orchestrating the shared streaming/reveal primitives. Exposes
// seed(text) so the draft editor's highlight toolbar can prefill the composer
// with a question about a selected passage.
const DraftChat = forwardRef<DraftChatHandle, { ordinance: Ordinance }>(
  function DraftChat({ ordinance }, ref): React.JSX.Element {
    const [conversationId, setConversationId] = useState<string | null>(null)
    const [messages, setMessages] = useState<ChatMessageDto[]>([])
    const [liveSegments, setLiveSegments] = useState<LiveSegment[]>([])
    const [composer, setComposer] = useState('')
    const [sending, setSending] = useState(false)
    const bottomRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const { visibleSegments, revealedRef } = useSmoothReveal(
      liveSegments,
      sending,
    )

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
    }, [ordinance.id, ordinance.slug, ordinance.draftTitle, ordinance.goalText])

    const send = useCallback(
      async (content: string): Promise<void> => {
        const id = conversationId
        const trimmed = content.trim()
        if (!id || !trimmed || sending) return
        setSending(true)
        setLiveSegments([])
        setComposer('')
        setMessages((prev) => [
          ...prev,
          {
            id: `pending-${crypto.randomUUID()}`,
            conversationId: id,
            role: 'user',
            content: trimmed,
            createdAt: new Date().toISOString(),
          },
        ])

        const segments: LiveSegment[] = []
        const pushText = (delta: string): void => {
          const last = segments[segments.length - 1]
          if (last && last.kind === 'text') {
            segments[segments.length - 1] = {
              kind: 'text',
              text: last.text + delta,
            }
          } else {
            segments.push({ kind: 'text', text: delta })
          }
          setLiveSegments([...segments])
        }

        try {
          for await (const event of ordinanceFlowChatApi.streamMessage({
            conversationId: id,
            content: trimmed,
            clientMessageId: crypto.randomUUID(),
          })) {
            if (event.type === 'text') {
              pushText(event.delta)
            } else if (
              event.type === 'tool_call' &&
              TOOL_LABELS[event.toolName]
            ) {
              segments.push({
                kind: 'tool',
                toolName: event.toolName,
                running: true,
              })
              setLiveSegments([...segments])
            } else if (event.type === 'tool_result') {
              for (let i = segments.length - 1; i >= 0; i--) {
                const s = segments[i]
                if (
                  s &&
                  s.kind === 'tool' &&
                  s.toolName === event.toolName &&
                  s.running
                ) {
                  segments[i] = { ...s, running: false }
                  setLiveSegments([...segments])
                  break
                }
              }
            }
          }
          const total = segmentsTextLength(segments)
          let ticks = 0
          while (
            revealedRef.current < total &&
            ticks < REVEAL_DRAIN_MAX_TICKS
          ) {
            await new Promise((resolve) =>
              setTimeout(resolve, REVEAL_DRAIN_POLL_MS),
            )
            ticks += 1
          }
          const history = await ordinanceFlowChatApi.listMessages(id)
          setMessages(history)
        } catch {
          // Swallow; the user can retry.
        } finally {
          setLiveSegments([])
          setSending(false)
        }
      },
      [conversationId, sending, revealedRef],
    )

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

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div
                key={m.id}
                className="self-end rounded-2xl bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
              >
                {m.content}
              </div>
            ) : (
              <AssistantRow key={m.id}>
                <InlineSegments
                  segments={toLive(m.segments ?? [], m.content)}
                  toolLabel={toolLabel}
                />
              </AssistantRow>
            ),
          )}

          {visibleSegments.length > 0 ? (
            <AssistantRow>
              <InlineSegments
                segments={visibleSegments}
                toolLabel={toolLabel}
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
            void send(composer)
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
