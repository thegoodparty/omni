'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, IconButton, Input } from '@styleguide'
import { ChevronRightIcon, SendIcon } from '@styleguide/components/ui/icons'
import {
  OrdinanceClarifyQuestionSchema,
  OrdinanceNextStepOfferSchema,
  type ChatAnchor,
  type Ordinance,
  type OrdinanceClarifyQuestion,
  type OrdinanceFlowStep,
  type OrdinanceNextStepOffer,
} from '@goodparty_org/contracts'
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
import { fetchOrdinanceBySlug } from '../data/ordinances-api'
import {
  ORDINANCE_STEP_LABELS,
  isOrdinanceStep,
  nextOrdinanceStep,
} from '../data/steps'
import ClarifyQuestionWidget from './ClarifyQuestionWidget'
import OrdinanceStepper from './OrdinanceStepper'

const CLARIFY_TOOL = 'ask_clarify_question'
const OFFER_TOOL = 'offer_next_step'

// How often send polls the smooth-reveal counter while draining the tail after
// the network stream ends, plus a backstop tick cap so an unmount mid-drain can
// never wedge the loop (250 * 40ms = 10s ceiling).
const REVEAL_DRAIN_POLL_MS = 40
const REVEAL_DRAIN_MAX_TICKS = 250

// User-meaningful "working" actions shown as shimmer pills. Bookkeeping tools
// (ask_clarify_question renders as the widget; save_answer/save_note are
// internal) are intentionally absent, so they never show a pill — while the
// agent works toward the next question the "Thinking..." shimmer covers it.
const TOOL_LABELS: Record<string, string> = {
  web_search: 'Searching the web',
  read_ordinance: 'Reviewing your ordinance',
  get_current_code: 'Checking the current code',
}

// Hidden opener sent once for a brand-new conversation so the agent takes the
// first turn and asks its opening clarifying question without the user having to
// type. Filtered out of the transcript on both live send and reload.
const KICKOFF =
  "Let's begin. Ask me your first clarifying question about this ordinance."

type Phase = 'loading' | 'ready' | 'error'

const parseClarify = (value: unknown): OrdinanceClarifyQuestion | null => {
  const parsed = OrdinanceClarifyQuestionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// The clarify question a persisted assistant turn asked (from its tool segment
// payload), so the widget renders inline in that turn on reload.
const clarifyFromSegments = (
  segments: ChatMessageSegment[],
): OrdinanceClarifyQuestion | null => {
  const segment = segments.find((s) => s.toolName === CLARIFY_TOOL)
  return segment ? parseClarify(segment.payload) : null
}

const parseOffer = (value: unknown): OrdinanceNextStepOffer | null => {
  const parsed = OrdinanceNextStepOfferSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// True when a persisted assistant turn offered to advance to the next step.
const hasOfferSegment = (segments: ChatMessageSegment[]): boolean =>
  segments.some((s) => s.toolName === OFFER_TOOL)

const offerLabelFromSegments = (
  segments: ChatMessageSegment[],
): string | undefined => {
  const segment = segments.find((s) => s.toolName === OFFER_TOOL)
  return segment ? (parseOffer(segment.payload)?.label ?? undefined) : undefined
}

const buildAnchor = (
  ordinance: Ordinance,
  slug: string,
  step: OrdinanceFlowStep,
): ChatAnchor => ({
  resourceType: 'ordinance',
  resourceId: ordinance.id,
  url: `/dashboard/ordinances/solve/${slug}/${step}`,
  snapshot: {
    title: ordinance.draftTitle ?? ordinance.goalText ?? 'Untitled ordinance',
    summary: ordinance.goalText ?? '',
  },
  step,
})

export default function OrdinanceFlowChat({
  slug,
  step,
}: {
  slug: string
  step: string
}): React.JSX.Element {
  const stepValue = isOrdinanceStep(step) ? step : null

  const [phase, setPhase] = useState<Phase>(stepValue ? 'loading' : 'error')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [ordinanceTitle, setOrdinanceTitle] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [recordedAnswers, setRecordedAnswers] = useState<
    Array<{ question: string; answer: string }>
  >([])
  const [messages, setMessages] = useState<ChatMessageDto[]>([])
  const [liveSegments, setLiveSegments] = useState<LiveSegment[]>([])
  const [liveClarify, setLiveClarify] =
    useState<OrdinanceClarifyQuestion | null>(null)
  const [liveOffer, setLiveOffer] = useState<OrdinanceNextStepOffer | null>(
    null,
  )
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Smooth type-out for the in-flight turn: the reveal trails the arrived text
  // and drains after the stream ends (useSmoothReveal). `revealedRef` lets send
  // hold the history swap until the tail has typed out.
  const { visibleSegments, revealedRef } = useSmoothReveal(
    liveSegments,
    sending,
  )

  const nextStep = stepValue ? nextOrdinanceStep(stepValue) : null
  const goToNextStep = useCallback(() => {
    if (nextStep) router.push(`/dashboard/ordinances/solve/${slug}/${nextStep}`)
  }, [router, slug, nextStep])

  const send = useCallback(
    async (
      content: string,
      opts?: { hidden?: boolean; idOverride?: string },
    ): Promise<void> => {
      const id = opts?.idOverride ?? conversationId
      const trimmed = content.trim()
      if (!id || !trimmed || sending) return
      setSending(true)
      setStreamError(null)
      setLiveSegments([])
      setLiveClarify(null)
      setLiveOffer(null)
      if (!opts?.hidden) {
        setComposer('')
        const optimistic: ChatMessageDto = {
          id: `pending-${crypto.randomUUID()}`,
          conversationId: id,
          role: 'user',
          content: trimmed,
          createdAt: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, optimistic])
      }

      // Build the turn as interleaved text + tool segments so pills render
      // inline in stream order; consecutive text deltas coalesce into one block.
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
          } else if (event.type === 'tool_call') {
            if (event.toolName === CLARIFY_TOOL) {
              const parsed = parseClarify(event.args)
              if (parsed) setLiveClarify(parsed)
            } else if (event.toolName === OFFER_TOOL) {
              setLiveOffer(parseOffer(event.args) ?? {})
            } else if (TOOL_LABELS[event.toolName]) {
              segments.push({ kind: 'tool', toolName: event.toolName })
              setLiveSegments([...segments])
            }
          } else if (event.type === 'error') {
            setStreamError(event.message)
          }
        }
        // Hold the swap to persisted history until the smooth reveal has typed
        // out the tail, so the last words don't snap in on the handoff.
        const total = segmentsTextLength(segments)
        let ticks = 0
        while (revealedRef.current < total && ticks < REVEAL_DRAIN_MAX_TICKS) {
          await new Promise((resolve) =>
            setTimeout(resolve, REVEAL_DRAIN_POLL_MS),
          )
          ticks += 1
        }
        const history = await ordinanceFlowChatApi.listMessages(id)
        setMessages(history)
      } catch {
        setStreamError('Something went wrong. Please try again.')
      } finally {
        setLiveSegments([])
        setLiveClarify(null)
        setLiveOffer(null)
        setSending(false)
      }
    },
    [conversationId, sending],
  )

  const answerClarify = useCallback(
    (questionId: string, answer: string): void => {
      // Optimistic: highlight the pick immediately. The turn is sent hidden (no
      // echoed text bubble) so only the highlighted option represents the answer.
      setAnswers((prev) => ({ ...prev, [questionId]: answer }))
      void send(answer, { hidden: true })
    },
    [send],
  )

  // Keep a stable handle to the latest `send` so the init effect can trigger the
  // kickoff without re-running whenever `send` changes (it changes on every
  // `sending` toggle).
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  useEffect(() => {
    if (!stepValue) return
    let cancelled = false
    const init = async (): Promise<void> => {
      try {
        const ordinance = await fetchOrdinanceBySlug(slug)
        const anchor = buildAnchor(ordinance, slug, stepValue)
        const { conversationId: id } =
          await ordinanceFlowChatApi.createConversation(anchor)
        const history = await ordinanceFlowChatApi.listMessages(id)
        if (cancelled) return
        setConversationId(id)
        setOrdinanceTitle(
          ordinance.draftTitle ?? ordinance.goalText ?? 'Untitled ordinance',
        )
        setRecordedAnswers(
          (ordinance.clarifyAnswers ?? []).map((a) => ({
            question: a.question,
            answer: a.answer,
          })),
        )
        setMessages(history)
        setPhase('ready')
        // Brand-new conversation: let the agent take the first turn.
        if (history.length === 0) {
          void sendRef.current(KICKOFF, { hidden: true, idOverride: id })
        }
      } catch {
        if (!cancelled) setPhase('error')
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [slug, stepValue])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, visibleSegments, liveClarify])

  if (phase === 'loading') {
    return <div className="p-6 text-tertiary">Loading your ordinance...</div>
  }

  if (phase === 'error' || !stepValue) {
    return (
      <div className="p-6 text-tertiary">
        We couldn&apos;t open this ordinance step. Check the link and try again.
      </div>
    )
  }

  // Ordered assistant turns that asked a clarify question.
  const clarifyMessages = messages.filter(
    (m) =>
      m.role === 'assistant' &&
      (m.segments ?? []).some((s) => s.toolName === CLARIFY_TOOL),
  )
  // Persisted answers keyed by question text — stable across re-answers (which
  // reorder the stored list) and independent of the agent's save_answer
  // questionId (which doesn't match the widget's), unlike ordinal pairing.
  const recordedByQuestion = new Map(
    recordedAnswers.map((a) => [a.question, a.answer]),
  )
  // Resolve each clarify turn's answer: the optimistic session pick first
  // (exact, keyed by the question's own id), else the persisted answer for the
  // same question text.
  const answerByMessageId: Record<string, string> = {}
  for (const m of clarifyMessages) {
    const q = clarifyFromSegments(m.segments ?? [])
    if (!q) continue
    const resolved = answers[q.questionId] ?? recordedByQuestion.get(q.question)
    if (resolved != null) answerByMessageId[m.id] = resolved
  }

  // An answered clarify turn is represented by its highlighted option, so the
  // raw user turn that carried the answer (sent hidden right after the widget)
  // is dropped. We hide by position — the first matching user turn after each
  // answered widget — so a later free-text message that merely repeats an
  // answer's words is NOT hidden.
  const hiddenIds = new Set<string>()
  clarifyMessages.forEach((m) => {
    const answer = answerByMessageId[m.id]
    if (answer == null) return
    const widgetIdx = messages.findIndex((x) => x.id === m.id)
    const turn = messages
      .slice(widgetIdx + 1)
      .find(
        (x) =>
          x.role === 'user' && x.content === answer && !hiddenIds.has(x.id),
      )
    if (turn) hiddenIds.add(turn.id)
  })
  const visibleMessages = messages.filter(
    (m) =>
      !(m.role === 'user' && m.content === KICKOFF) && !hiddenIds.has(m.id),
  )
  // Only the most recent clarify question is interactive; earlier ones render
  // read-only in place.
  const activeClarifyId =
    clarifyMessages[clarifyMessages.length - 1]?.id ?? null
  // The reveal has caught up to everything that has arrived. Gate the clarify
  // widget and the next-step button on this so they appear after the lead-in
  // text has typed out, not before.
  const revealDone =
    segmentsTextLength(visibleSegments) >= segmentsTextLength(liveSegments)
  const showClarify = Boolean(liveClarify) && revealDone
  const showOffer = Boolean(liveOffer) && revealDone
  // Thinking shimmer only for the initial compose gap, before any text or
  // widget has appeared for this turn.
  const working =
    sending && visibleSegments.length === 0 && !liveClarify && !liveOffer

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-4">
        <header className="flex flex-col gap-3">
          <OrdinanceStepper current={stepValue} />
          {ordinanceTitle ? (
            <h1 className="text-xl font-semibold text-foreground">
              {ordinanceTitle}
            </h1>
          ) : null}
        </header>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {visibleMessages.map((message) =>
            message.role === 'user' ? (
              <div
                key={message.id}
                className="self-end rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground"
              >
                {message.content}
              </div>
            ) : (
              <AssistantMessage
                key={message.id}
                message={message}
                answer={answerByMessageId[message.id]}
                interactive={
                  message.id === activeClarifyId &&
                  !answerByMessageId[message.id] &&
                  !sending
                }
                onAnswerClarify={answerClarify}
                {...(nextStep
                  ? {
                      onAdvance: goToNextStep,
                      nextLabel: ORDINANCE_STEP_LABELS[nextStep],
                    }
                  : {})}
              />
            ),
          )}

          {(visibleSegments.length > 0 || showClarify || working) && (
            <AssistantRow>
              {visibleSegments.length > 0 ? (
                <InlineSegments
                  segments={visibleSegments}
                  toolLabel={(name) => TOOL_LABELS[name] ?? null}
                  running
                />
              ) : null}
              {showClarify && liveClarify ? (
                <ClarifyQuestionWidget
                  question={liveClarify}
                  disabled
                  onAnswer={() => undefined}
                />
              ) : null}
              {working ? (
                <div className="w-fit self-start rounded-2xl bg-muted px-3 py-2 text-sm">
                  <span className="text-shimmer-muted">Thinking...</span>
                </div>
              ) : null}
            </AssistantRow>
          )}

          {showOffer && liveOffer && nextStep ? (
            <NextStepButton
              label={liveOffer.label}
              nextLabel={ORDINANCE_STEP_LABELS[nextStep]}
              onAdvance={goToNextStep}
            />
          ) : null}

          {streamError ? (
            <p className="text-sm text-destructive">{streamError}</p>
          ) : null}

          <div ref={bottomRef} />
        </div>

        <form
          className="flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-4 pr-1"
          onSubmit={(e) => {
            e.preventDefault()
            void send(composer)
          }}
        >
          <Input
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            placeholder="Ask me any questions about this..."
            disabled={sending}
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
    </div>
  )
}

function NextStepButton({
  label,
  nextLabel,
  onAdvance,
}: {
  label?: string
  nextLabel: string
  onAdvance: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onAdvance}
      className="h-auto w-full justify-between rounded-lg border-border bg-card px-4 py-3 text-foreground shadow-sm hover:border-foreground/20 hover:bg-muted/50 hover:text-foreground"
    >
      <span>{label ?? `Continue to ${nextLabel}`}</span>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Button>
  )
}

function AssistantMessage({
  message,
  answer,
  interactive,
  onAnswerClarify,
  onAdvance,
  nextLabel,
}: {
  message: ChatMessageDto
  answer?: string
  interactive: boolean
  onAnswerClarify: (questionId: string, answer: string) => void
  onAdvance?: () => void
  nextLabel?: string
}): React.JSX.Element {
  const segments = message.segments ?? []
  const clarify = clarifyFromSegments(segments)
  // Same interleaved model as the live turn: text and tool pills in stream
  // order, so a reloaded turn reads identically to how it streamed.
  const rendered: LiveSegment[] =
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
      : message.content
        ? [{ kind: 'text', text: message.content }]
        : []

  return (
    <>
      <AssistantRow>
        <InlineSegments
          segments={rendered}
          toolLabel={(name) => TOOL_LABELS[name] ?? null}
        />
        {clarify ? (
          <ClarifyQuestionWidget
            question={clarify}
            disabled={!interactive}
            {...(answer !== undefined ? { answer } : {})}
            onAnswer={(a) => onAnswerClarify(clarify.questionId, a)}
          />
        ) : null}
      </AssistantRow>
      {hasOfferSegment(segments) && onAdvance && nextLabel ? (
        <NextStepButton
          label={offerLabelFromSegments(segments)}
          nextLabel={nextLabel}
          onAdvance={onAdvance}
        />
      ) : null}
    </>
  )
}
