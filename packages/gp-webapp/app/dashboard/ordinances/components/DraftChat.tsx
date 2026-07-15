'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatAnchor, Ordinance } from '@goodparty_org/contracts'
import {
  AssistantRow,
  ChatComposer,
  InlineSegments,
  ThinkingRow,
  UserBubble,
} from '../../shared/agent-chat/chatUI'
import { segmentsToLive } from '../../shared/agent-chat/streaming'
import { useStreamingTurn } from '../../shared/agent-chat/useStreamingTurn'
import { ordinanceFlowChatApi } from '../data/chat-api'
import { ordinanceToolLabel } from '../data/toolLabels'

// A slim chat about the draft: the ordinance_flow conversation anchored to the
// draft step. Streaming, reveal, and the turn loop come from the shared
// useStreamingTurn driver; this component only adds the composer and history
// rendering. `seedText` prefills the composer with a question about a highlighted
// passage; `seedNonce` bumps on each highlight so re-selecting the same text
// re-seeds (the drawer host remounts this on open, so seeding is a prop).
export default function DraftChat({
  ordinance,
  seedText = '',
  seedNonce = 0,
}: {
  ordinance: Ordinance
  seedText?: string
  seedNonce?: number
}): React.JSX.Element {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [composer, setComposer] = useState(seedText)
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
            ordinance.draftTitle ?? ordinance.goalText ?? 'Untitled ordinance',
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

  // Seed the composer from a highlighted passage. Keyed on seedNonce so
  // re-highlighting the same text re-seeds; skips the initial 0 nonce (the
  // composer already initialised from seedText on mount).
  useEffect(() => {
    if (seedNonce === 0) return
    setComposer(seedText)
    inputRef.current?.focus()
  }, [seedNonce, seedText])

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
            <UserBubble key={m.id}>{m.content}</UserBubble>
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

        {working ? <ThinkingRow /> : null}

        <div ref={bottomRef} />
      </div>

      <ChatComposer
        value={composer}
        onChange={setComposer}
        onSubmit={() => {
          if (!conversationId) return
          const text = composer
          setComposer('')
          void send(conversationId, text)
        }}
        disabled={sending || !conversationId}
        inputRef={inputRef}
      />
    </div>
  )
}
