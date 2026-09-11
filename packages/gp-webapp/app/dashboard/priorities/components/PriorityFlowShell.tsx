'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Label, Switch } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import type { Priority } from '@goodparty_org/contracts'
import { toolDisplayName } from '../../chief-of-staff/components/chat/chatConstants'
import {
  ASSISTANT_BUBBLE,
  AssistantRow,
  ChatComposer,
  InlineSegments,
  ThinkingRow,
  UserBubble,
} from '../../shared/agent-chat/chatUI'
import { segmentsToLive } from '../../shared/agent-chat/streaming'
import { usePinnedAutoScroll } from '../../shared/agent-chat/usePinnedAutoScroll'
import { useStreamingTurn } from '../../shared/agent-chat/useStreamingTurn'
import { priorityFlowChatApi } from '../data/chat-api'
import { buildStepPrompt } from '../data/stepPrompts'
import {
  PRIORITY_NEXT_STEP_CTA,
  PRIORITY_STEP_CAPTIONS,
  PRIORITY_STEP_LABELS,
  nextPriorityStep,
  type PriorityFlowStep,
} from '../data/steps'
import PriorityStepper from './PriorityStepper'

// The flow around one priority, in the ordinance flow's shell and running a
// real agent turn per step. Each step sends its ask hidden (see
// data/stepPrompts.ts) so the user sees an answer about THEIR priority rather
// than canned copy, and the composer is live for follow-ups.
//
// Step state lives here: the flow has no backend, so nothing is persisted and a
// reload starts the conversation over. Once gp-api owns the record, `step`
// becomes a route segment the way ordinances/solve/[slug]/[step] does.
export default function PriorityFlowShell({
  priority,
}: {
  priority: Priority
}): React.JSX.Element {
  const router = useRouter()
  const [step, setStep] = useState<PriorityFlowStep>('define')
  const [composer, setComposer] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  // The step asks are sent hidden, so their persisted user turns have to be
  // dropped from the transcript by content — the engine reconciles against the
  // raw server history, which includes them.
  const [hiddenSent, setHiddenSent] = useState<string[]>([])
  const creatingRef = useRef(false)

  const toolLabel = useCallback((name: string): string => {
    return toolDisplayName(name)
  }, [])

  const { messages, visibleSegments, sending, send, isStreaming } =
    useStreamingTurn(priorityFlowChatApi, {
      toolLabel,
      onTurnStart: () => setStreamError(null),
      onError: (message) => setStreamError(message),
    })

  const askStep = useCallback(
    (target: PriorityFlowStep, id: string): void => {
      const prompt = buildStepPrompt(target, priority)
      setHiddenSent((prev) => [...prev, prompt])
      void send(id, prompt, { hidden: true })
    },
    [priority, send],
  )
  // Held in a ref so the bootstrap effects don't take it as a dependency.
  const askStepRef = useRef(askStep)
  useEffect(() => {
    askStepRef.current = askStep
  }, [askStep])

  // One conversation for the whole flow session. Opened on mount, with no deps:
  // askStep's identity changes with every turn, and having it here opened a
  // fresh conversation per change.
  useEffect(() => {
    if (creatingRef.current) return
    creatingRef.current = true
    void (async () => {
      try {
        const { conversationId: id } =
          await priorityFlowChatApi.createConversation()
        setConversationId(id)
      } catch {
        setStartError(
          "We couldn't start work on this priority. Please try again.",
        )
      }
    })()
  }, [])

  // Kick off the first step once the conversation exists. Separate from the
  // create so a kickoff aborted on unmount (React's dev double-mount does this)
  // fires again on the mount that survives.
  const kickedOffRef = useRef(false)
  useEffect(() => {
    if (!conversationId || kickedOffRef.current) return
    kickedOffRef.current = true
    askStepRef.current('define', conversationId)
  }, [conversationId])

  const advance = (destination: PriorityFlowStep): void => {
    if (isStreaming() || !conversationId) return
    setStep(destination)
    askStep(destination, conversationId)
  }

  const hiddenContent = useMemo(() => new Set(hiddenSent), [hiddenSent])
  const visibleMessages = useMemo(
    () => messages.filter((m) => !hiddenContent.has(m.content)),
    [messages, hiddenContent],
  )

  const { scrollRef, onScroll } = usePinnedAutoScroll([
    visibleMessages,
    visibleSegments,
  ])

  const destination = nextPriorityStep(step)
  // Nothing visible from this turn yet: hold the shimmer rather than an empty
  // gap under the step's question.
  const working = sending && visibleSegments.length === 0

  return (
    <div className="flex h-[calc(100dvh-4rem)] w-full flex-col bg-background lg:h-dvh">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
          <header className="flex flex-col gap-3">
            <PriorityStepper current={step} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-xl font-semibold text-foreground">
                {priority.title}
              </h1>
              {/* Visibility has no column on Priority yet, so this holds for
                  the session only. */}
              <div className="flex items-center gap-2">
                <Switch
                  id="priority-visibility"
                  checked={isPublic}
                  onCheckedChange={setIsPublic}
                />
                <Label
                  htmlFor="priority-visibility"
                  className="text-sm font-normal text-muted-foreground"
                >
                  {isPublic ? 'On your public page' : 'Just for you'}
                </Label>
              </div>
            </div>
          </header>

          <div className="flex flex-col gap-3">
            {/* The step's own question, which belongs to the flow rather than
                to the model — the agent answers it below. */}
            <AssistantRow>
              <div className={ASSISTANT_BUBBLE}>
                <p className="font-medium">{PRIORITY_STEP_LABELS[step]}</p>
                <p>{PRIORITY_STEP_CAPTIONS[step]}</p>
              </div>
            </AssistantRow>

            {visibleMessages.map((message) =>
              message.role === 'user' ? (
                <UserBubble key={message.id}>{message.content}</UserBubble>
              ) : (
                <AssistantRow key={message.id}>
                  <InlineSegments
                    segments={segmentsToLive(
                      message.segments ?? [],
                      message.content,
                    )}
                    toolLabel={toolLabel}
                  />
                </AssistantRow>
              ),
            )}

            {visibleSegments.length > 0 || working ? (
              <AssistantRow>
                {visibleSegments.length > 0 ? (
                  <InlineSegments
                    segments={visibleSegments}
                    toolLabel={toolLabel}
                  />
                ) : null}
                {working ? <ThinkingRow /> : null}
              </AssistantRow>
            ) : null}

            {startError ? (
              <p className="text-sm text-destructive">{startError}</p>
            ) : null}
            {streamError ? (
              <p className="text-sm text-destructive">{streamError}</p>
            ) : null}

            {!sending && !startError ? (
              <NextStepRow
                label={
                  destination
                    ? PRIORITY_NEXT_STEP_CTA[destination]
                    : 'Back to your priorities'
                }
                onClick={() =>
                  destination
                    ? advance(destination)
                    : router.push('/dashboard/priorities')
                }
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background">
        <div className="mx-auto w-full max-w-3xl px-4 py-3">
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
            placeholder="Answer, or ask me anything about this priority..."
          />
        </div>
      </div>
    </div>
  )
}

// The advance affordance the ordinance flow uses: a full-width row rather than
// a button, so it reads as the next thing in the conversation.
function NextStepRow({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="h-auto w-full justify-between rounded-lg border-border bg-card px-4 py-3 text-sm text-foreground shadow-sm hover:border-foreground/20 hover:bg-muted/50 hover:text-foreground"
    >
      <span>{label}</span>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Button>
  )
}
