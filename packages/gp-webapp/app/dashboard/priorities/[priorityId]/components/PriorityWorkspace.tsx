'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
} from '@styleguide'
import { ListChecksIcon } from '@styleguide/components/ui/icons'
import {
  parsePriorityStatus,
  type ChatAnchor,
  type PriorityStatus,
} from '@goodparty_org/contracts'
import {
  AssistantRow,
  ChatComposer,
  ThinkingRow,
  UserBubble,
} from '../../../shared/agent-chat/chatUI'
import { segmentsTextLength } from '../../../shared/agent-chat/streaming'
import { useStreamingTurn } from '../../../shared/agent-chat/useStreamingTurn'
import { usePinnedAutoScroll } from '../../../shared/agent-chat/usePinnedAutoScroll'
import { useDictationAppend } from '../../../shared/dictation/useDictationAppend'
import { priorityFlowChatApi } from '../data/chat-api'
import { toChatCard } from '../data/cards'
import { fetchPriorityStatus } from '../data/priority-api'
import { replayStatusMarkers } from '../data/statusReplay'
import {
  STATUS_TOOL,
  applyStatusUpdate,
  parseStatusToolResult,
  parseStatusUpdate,
} from '../data/statusUpdates'
import { PriorityStatusRail } from './PriorityStatusRail'
import {
  TurnBlocks,
  liveTurnBlocks,
  persistedTurnBlocks,
  type PositionedExtra,
} from './turnBlocks'

// Hidden opener for a brand-new conversation, so the official arrives at a
// thread that has already started rather than an empty box. Filtered out of
// the transcript on both send and reload.
const KICKOFF =
  "Let's begin. Tell me where this stands and what we should work on first."

type Phase = 'loading' | 'ready' | 'error'

export const PriorityWorkspace = ({
  priorityId,
  title,
  description,
  initialStatus,
  initialNextAction,
}: {
  priorityId: string
  title: string
  description: string
  initialStatus: PriorityStatus
  initialNextAction: string | null
}): React.JSX.Element => {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('loading')
  const [retryNonce, setRetryNonce] = useState(0)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [status, setStatus] = useState<PriorityStatus>(() =>
    parsePriorityStatus(initialStatus),
  )
  const [nextAction, setNextAction] = useState<string | null>(initialNextAction)
  // The live status, readable synchronously. Two status tool calls can land in
  // one tick, and the second has to merge onto the first rather than onto the
  // last rendered value.
  const statusRef = useRef<PriorityStatus>(status)
  const commitStatus = useCallback(
    (next: PriorityStatus, action: string | null): void => {
      statusRef.current = next
      setStatus(next)
      setNextAction(action)
    },
    [],
  )
  const [liveExtras, setLiveExtras] = useState<PositionedExtra[]>([])
  const [composer, setComposer] = useState('')
  const [streamError, setStreamError] = useState<string | null>(null)
  const dictation = useDictationAppend({
    value: composer,
    onChange: setComposer,
    analyticsLabel: 'priority-chat',
  })

  // The rail's source of truth once a turn is over. Applied optimistically
  // from the tool call, corrected by the tool result, and finally reconciled
  // against what the server actually stored — so an interrupted turn cannot
  // leave the rail claiming a move that was never written.
  const reconcile = useCallback(async (): Promise<void> => {
    const persisted = await fetchPriorityStatus(priorityId)
    if (!persisted) return
    commitStatus(persisted.status, persisted.nextAction)
  }, [priorityId, commitStatus])

  const conversationIdRef = useRef<string | null>(null)
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  const {
    messages,
    setMessages,
    visibleSegments,
    sending,
    send: sendTurn,
  } = useStreamingTurn(priorityFlowChatApi, {
    toolLabel: () => null,
    onTurnStart: () => {
      setStreamError(null)
      setLiveExtras([])
    },
    onTurnSettle: () => {
      setLiveExtras([])
      void reconcile()
    },
    onError: (message) => setStreamError(message),
    onEvent: (event, { textLength }) => {
      if (event.type === 'tool_call' && event.toolName === STATUS_TOOL) {
        const update = parseStatusUpdate(event.args)
        if (!update) return true
        // The rail moves now, while the agent is still talking. That is most
        // of the feel, and the tool result a beat later corrects any drift.
        const applied = applyStatusUpdate(statusRef.current, update)
        commitStatus(applied.status, applied.nextAction)
        if (applied.changes.length > 0) {
          const at = textLength()
          setLiveExtras((prev) => [
            ...prev,
            {
              key: `status-${event.toolCallId ?? prev.length}`,
              extra: { kind: 'status', changes: applied.changes },
              appearAfter: at,
            },
          ])
        }
        return true
      }
      if (event.type === 'tool_result' && event.toolName === STATUS_TOOL) {
        const settled = parseStatusToolResult(event.result)
        if (settled) commitStatus(settled.status, settled.nextAction)
        return true
      }
      if (event.type === 'tool_call') {
        const card = toChatCard({
          toolName: event.toolName,
          args: event.args,
          toolCallId: event.toolCallId,
          conversationId: conversationIdRef.current ?? '',
        })
        if (card) {
          const at = textLength()
          setLiveExtras((prev) => [
            ...prev,
            {
              key: `card-${event.toolCallId ?? prev.length}`,
              extra: { kind: 'card', card },
              appearAfter: at,
            },
          ])
          return true
        }
      }
      // Everything else — counts, saved lists, web search — falls through to
      // the shared pill treatment the other chats use.
      return false
    },
  })

  const send = useCallback(
    (content: string, opts?: { hidden?: boolean; idOverride?: string }) => {
      const id = opts?.idOverride ?? conversationId
      if (!id) return
      void sendTurn(id, content, { hidden: opts?.hidden })
    },
    [conversationId, sendTurn],
  )
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  useEffect(() => {
    let cancelled = false
    const init = async (): Promise<void> => {
      try {
        const anchor: ChatAnchor = {
          resourceType: 'priority',
          resourceId: priorityId,
          url: `/dashboard/priorities/${priorityId}`,
          snapshot: { title, summary: description },
        }
        const { conversationId: id } =
          await priorityFlowChatApi.createConversation(anchor)
        const history = await priorityFlowChatApi.listMessages(id)
        if (cancelled) return
        conversationIdRef.current = id
        setConversationId(id)
        setMessages(history)
        setPhase('ready')
        if (history.length === 0) {
          sendRef.current(KICKOFF, { hidden: true, idOverride: id })
        }
      } catch {
        if (!cancelled) setPhase('error')
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [priorityId, title, description, setMessages, retryNonce])

  const markers = useMemo(() => replayStatusMarkers(messages), [messages])
  const visibleMessages = useMemo(
    () => messages.filter((m) => !(m.role === 'user' && m.content === KICKOFF)),
    [messages],
  )

  const { scrollRef, onScroll } = usePinnedAutoScroll([
    messages,
    visibleSegments,
    liveExtras,
  ])

  const revealedTextLength = segmentsTextLength(visibleSegments)
  const blocks = liveTurnBlocks(visibleSegments, liveExtras, revealedTextLength)
  // Hold the shimmer until something has actually painted, so there is no
  // empty flash between "Thinking..." and the first word.
  const working = sending && blocks.length === 0
  const railTitle = 'Where this stands'

  if (phase === 'error') {
    return (
      <div className="flex h-[calc(100dvh-4rem)] w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center lg:h-dvh">
        <p className="text-tertiary">
          We couldn&apos;t open this priority. That is usually temporary.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            className="rounded-full"
            onClick={() => {
              setPhase('loading')
              setRetryNonce((n) => n + 1)
            }}
          >
            Try again
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => router.push('/dashboard/priorities')}
          >
            Back to priorities
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] w-full bg-background lg:h-dvh">
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
            <header className="flex items-start justify-between gap-3">
              <h1 className="text-xl font-semibold text-foreground">{title}</h1>
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    size="small"
                    className="shrink-0 gap-1.5 lg:hidden"
                  >
                    <ListChecksIcon className="size-4" aria-hidden />
                    {railTitle}
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="max-h-[85dvh]">
                  <SheetHeader>
                    <SheetTitle>{railTitle}</SheetTitle>
                  </SheetHeader>
                  <SheetBody>
                    <PriorityStatusRail
                      status={status}
                      nextAction={nextAction}
                      className="border-0 shadow-none"
                    />
                  </SheetBody>
                </SheetContent>
              </Sheet>
            </header>

            {phase === 'loading' ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                <div className="flex items-start gap-2">
                  <Skeleton className="size-6 shrink-0 rounded-full" />
                  <Skeleton className="h-20 w-80 max-w-full rounded-2xl" />
                </div>
                <div className="flex items-start gap-2">
                  <Skeleton className="size-6 shrink-0 rounded-full" />
                  <Skeleton className="h-12 w-64 max-w-full rounded-2xl" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {visibleMessages.map((message) =>
                  message.role === 'user' ? (
                    <UserBubble key={message.id}>{message.content}</UserBubble>
                  ) : (
                    <AssistantRow key={message.id} fullWidth>
                      <TurnBlocks
                        blocks={persistedTurnBlocks({
                          messageId: message.id,
                          segments: message.segments ?? [],
                          content: message.content,
                          conversationId: conversationId ?? '',
                          markers,
                        })}
                        priorityId={priorityId}
                        conversationId={conversationId ?? ''}
                      />
                    </AssistantRow>
                  ),
                )}

                {blocks.length > 0 || working ? (
                  <AssistantRow fullWidth>
                    <TurnBlocks
                      blocks={blocks}
                      priorityId={priorityId}
                      conversationId={conversationId ?? ''}
                    />
                    {working ? <ThinkingRow /> : null}
                  </AssistantRow>
                ) : null}

                {streamError ? (
                  <p className="text-sm text-destructive">{streamError}</p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background">
          <div className="mx-auto w-full max-w-3xl px-4 py-3">
            <ChatComposer
              value={composer}
              onChange={setComposer}
              onSubmit={() => {
                const text = composer
                setComposer('')
                send(text)
              }}
              disabled={sending || phase !== 'ready'}
              placeholder="Ask about this priority, or tell me what changed..."
              ariaLabel="Message about this priority"
              dictation={dictation}
            />
          </div>
        </div>
      </div>

      <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border p-4 lg:block">
        <PriorityStatusRail status={status} nextAction={nextAction} />
      </aside>
    </div>
  )
}
