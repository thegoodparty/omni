'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ordinance } from '@goodparty_org/contracts'
import {
  AssistantRow,
  ChatComposer,
  InlineSegments,
  ThinkingRow,
  UserBubble,
} from '../../shared/agent-chat/chatUI'
import { segmentsToLive } from '../../shared/agent-chat/streaming'
import { useStreamingTurn } from '../../shared/agent-chat/useStreamingTurn'
import { useDictationAppend } from '../../briefings/shared/useDictationAppend'
import { buildOrdinanceAnchor } from '../data/anchor'
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
  autoDictate = false,
}: {
  ordinance: Ordinance
  seedText?: string
  seedNonce?: number
  autoDictate?: boolean
}): React.JSX.Element {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [composer, setComposer] = useState(seedText)
  const dictation = useDictationAppend({
    value: composer,
    onChange: setComposer,
    analyticsLabel: 'ordinance-draft-chat',
  })
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Opened from the launcher's mic: begin dictation once, on mount, while the
  // opening tap is still a fresh user gesture for the mic permission prompt.
  const autoDictateStartedRef = useRef(false)
  useEffect(() => {
    if (autoDictate && !autoDictateStartedRef.current) {
      autoDictateStartedRef.current = true
      void dictation.start()
    }
  }, [autoDictate, dictation])

  const { messages, setMessages, visibleSegments, sending, send } =
    useStreamingTurn(ordinanceFlowChatApi, { toolLabel: ordinanceToolLabel })

  useEffect(() => {
    let cancelled = false
    const init = async (): Promise<void> => {
      const anchor = buildOrdinanceAnchor(ordinance, {
        url: `/dashboard/ordinances/draft/${ordinance.slug}`,
        // Its own conversation and tools, separate from the flow's draft step.
        step: 'review',
      })
      try {
        const { conversationId: id } =
          await ordinanceFlowChatApi.createConversation(anchor)
        if (cancelled) return
        // Enable the composer as soon as the conversation exists, even if the
        // history reload below fails — otherwise a listMessages error would
        // leave the composer permanently disabled with no retry path.
        setConversationId(id)
        try {
          const history = await ordinanceFlowChatApi.listMessages(id)
          if (cancelled) return
          setMessages(history)
        } catch {
          // History unavailable; the composer stays usable so the user can send.
        }
      } catch {
        // Couldn't open the conversation; the composer stays disabled.
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
  }, [seedNonce, seedText])

  // Focus the composer once it is enabled. The input stays disabled until the
  // conversation resolves, and the drawer remounts this component on each open,
  // so focusing at seed time would land on a still-disabled input (a no-op).
  useEffect(() => {
    if (seedNonce !== 0 && conversationId) inputRef.current?.focus()
  }, [seedNonce, conversationId])

  // A new persisted turn scrolls in smoothly.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Stay pinned to the bottom as the live turn streams. visibleSegments updates
  // ~40x/s, so use an instant scroll (a smooth one would restart its animation
  // every tick and never settle).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [visibleSegments])

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
        dictation={dictation}
      />
    </div>
  )
}
