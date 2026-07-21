'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Skeleton } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import {
  OrdinanceClarifyQuestionSchema,
  OrdinanceNextStepOfferSchema,
  type ChatAnchor,
  type Ordinance,
  type OrdinanceClarifyAnswer,
  type OrdinanceClarifyQuestion,
  type OrdinanceFlowStep,
  type OrdinanceNextStepOffer,
} from '@goodparty_org/contracts'
import type {
  ChatMessageDto,
  ChatMessageSegment,
} from '../../shared/agent-chat/chatClient'
import {
  AssistantRow,
  ChatComposer,
  InlineSegments,
  ThinkingRow,
  UserBubble,
} from '../../shared/agent-chat/chatUI'
import {
  segmentsTextLength,
  segmentsToLive,
} from '../../shared/agent-chat/streaming'
import { useStreamingTurn } from '../../shared/agent-chat/useStreamingTurn'
import { usePinnedAutoScroll } from '../../shared/agent-chat/usePinnedAutoScroll'
import { useDictationAppend } from '../../briefings/shared/useDictationAppend'
import { buildOrdinanceAnchor } from '../data/anchor'
import { ordinanceFlowChatApi } from '../data/chat-api'
import { fetchOrdinanceBySlug, saveClarifyAnswer } from '../data/ordinances-api'
import { ordinanceToolLabel } from '../data/toolLabels'
import {
  ORDINANCE_NEXT_STEP_CTA,
  isOrdinanceStep,
  nextOrdinanceStep,
} from '../data/steps'
import ClarifyQuestionWidget from './ClarifyQuestionWidget'
import OrdinanceStepper from './OrdinanceStepper'
import {
  StepWidgetBlocks,
  isStepWidgetTool,
  parseStepWidget,
  parseStepWidgets,
  type StepWidgetInstance,
} from './stepWidgets'

const CLARIFY_TOOL = 'ask_clarify_question'
const OFFER_TOOL = 'offer_next_step'

// User-meaningful "working" actions shown as shimmer pills. Bookkeeping tools
// (ask_clarify_question renders as the widget; save_note/save_synthesis are
// internal) are intentionally absent, so they never show a pill — while the
// agent works toward the next question the "Thinking..." shimmer covers it.
// The label map (ORDINANCE_TOOL_LABELS) is shared with the draft chat.

// While the model is still writing a tool call's arguments (the tool_input_start
// signal, before the call completes), show what it is working on instead of a
// generic "Thinking...". Covers the wait while the clarify question generates.
const GENERATING_LABELS: Record<string, string> = {
  [CLARIFY_TOOL]: 'Preparing your question...',
  [OFFER_TOOL]: 'Preparing next steps...',
}

// Hidden opener sent once for a brand-new conversation so the agent takes the
// first turn without the user having to type. Step-specific: the clarify
// opener invites a question, but sending that same line on the draft step told
// the model to interview instead of drafting (a real session got a six-question
// prose interview and no saved draft out of it). Filtered out of the
// transcript on both live send and reload.
const CLARIFY_KICKOFF =
  "Let's begin. Ask me your first clarifying question about this ordinance."
const KICKOFFS: Record<string, string> = {
  intro:
    "Let's begin. Walk me through what this flow will do for this ordinance.",
  clarify: CLARIFY_KICKOFF,
  authority:
    "Let's begin. Check whether we have the legal authority to enact this.",
  current_law:
    "Let's begin. Show me what current law already does here and the gaps.",
  comparables: "Let's begin. Show me how comparable cities handled this.",
  draft: "Let's begin. Draft the ordinance from what the prior steps settled.",
  review: "Let's begin. Give me a quick orientation to this draft.",
}
const kickoffFor = (step: string): string => KICKOFFS[step] ?? CLARIFY_KICKOFF
// Reload filter must hide every kickoff variant, or an old conversation's
// opener resurfaces as a visible user message after the text changes.
const KICKOFF_TEXTS = new Set([CLARIFY_KICKOFF, ...Object.values(KICKOFFS)])

type Phase = 'loading' | 'ready' | 'error'

const parseClarify = (value: unknown): OrdinanceClarifyQuestion | null => {
  const parsed = OrdinanceClarifyQuestionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// Project a persisted clarify answer into the local recordedAnswers shape
// (drops the optional source, which reconciliation does not use).
const toRecordedAnswer = (
  a: OrdinanceClarifyAnswer,
): { questionId: string; question: string; answer: string } => ({
  questionId: a.questionId,
  question: a.question,
  answer: a.answer,
})

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

const buildAnchor = (
  ordinance: Ordinance,
  slug: string,
  step: OrdinanceFlowStep,
): ChatAnchor =>
  buildOrdinanceAnchor(ordinance, {
    url: `/dashboard/ordinances/solve/${slug}/${step}`,
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
    Array<{ questionId: string; question: string; answer: string }>
  >([])
  const [liveClarify, setLiveClarify] =
    useState<OrdinanceClarifyQuestion | null>(null)
  const [liveOffer, setLiveOffer] = useState<OrdinanceNextStepOffer | null>(
    null,
  )
  // Each live widget records how much turn text preceded its tool call, so it
  // appears only after that text has typed out — and, unlike a turn-global
  // revealDone gate, never unmounts when later text in the same turn streams.
  const [liveWidgets, setLiveWidgets] = useState<
    Array<{ instance: StepWidgetInstance; appearAfter: number }>
  >([])
  // The tool whose arguments the model is currently writing, if any, so the
  // working shimmer can name it (e.g. "Preparing your question...").
  const [generatingTool, setGeneratingTool] = useState<string | null>(null)
  const [composer, setComposer] = useState('')
  const dictation = useDictationAppend({
    value: composer,
    onChange: setComposer,
    analyticsLabel: 'ordinance-flow-chat',
  })
  const [streamError, setStreamError] = useState<string | null>(null)
  // Synchronous double-submit guard for answerClarify: setSending/setAnswers
  // are async, so a fast double-tap could otherwise fire two persists and two
  // streams before the first re-render locks the widget.
  const answeringRef = useRef(false)
  const router = useRouter()

  // The shared streaming-turn driver owns the mechanical turn: optimistic push,
  // interleaved text/pill assembly, the stream loop, and the reveal-drain handoff
  // to persisted history. This step's structured output — clarify/offer/step
  // widgets and the "generating" label — layers on through the handler seams.
  const {
    messages,
    setMessages,
    liveSegments,
    visibleSegments,
    sending,
    send: sendTurn,
  } = useStreamingTurn(ordinanceFlowChatApi, {
    toolLabel: ordinanceToolLabel,
    onTurnStart: () => {
      setStreamError(null)
      setLiveClarify(null)
      setLiveOffer(null)
      setLiveWidgets([])
      setGeneratingTool(null)
    },
    onTurnSettle: () => {
      setLiveClarify(null)
      setLiveOffer(null)
      setLiveWidgets([])
      setGeneratingTool(null)
    },
    onError: (message) => setStreamError(message),
    onEvent: (event, { textLength }) => {
      if (event.type === 'tool_input_start') {
        setGeneratingTool(event.toolName)
        return true
      }
      if (event.type === 'tool_call') {
        setGeneratingTool(null)
        if (event.toolName === CLARIFY_TOOL) {
          const parsed = parseClarify(event.args)
          if (parsed) setLiveClarify(parsed)
          return true
        }
        if (event.toolName === OFFER_TOOL) {
          setLiveOffer(parseOffer(event.args) ?? {})
          return true
        }
        if (isStepWidgetTool(event.toolName)) {
          const widget = parseStepWidget(event.toolName, event.args)
          if (widget) {
            setLiveWidgets((prev) => [
              ...prev,
              { instance: widget, appearAfter: textLength() },
            ])
          }
          return true
        }
      }
      return false
    },
  })

  // Thin wrapper preserving this component's call sites: resolve the target
  // conversation (idOverride lets the kickoff fire before state settles) and let
  // the shared driver run the turn.
  const send = useCallback(
    (
      content: string,
      opts?: { hidden?: boolean; idOverride?: string },
    ): Promise<void> => {
      const id = opts?.idOverride ?? conversationId
      if (!id) return Promise.resolve()
      return sendTurn(id, content, { hidden: opts?.hidden })
    },
    [conversationId, sendTurn],
  )

  const nextStep = stepValue ? nextOrdinanceStep(stepValue) : null
  const goToNextStep = useCallback(() => {
    if (nextStep) router.push(`/dashboard/ordinances/solve/${slug}/${nextStep}`)
  }, [router, slug, nextStep])

  const answerClarify = useCallback(
    (questionId: string, question: string, answer: string): void => {
      if (answeringRef.current) return
      answeringRef.current = true
      // Optimistic: highlight the pick immediately. The turn is sent hidden (no
      // echoed text bubble) so only the highlighted option represents the answer.
      setAnswers((prev) => ({ ...prev, [questionId]: answer }))
      void (async () => {
        // Persist the answer verbatim as the source of truth (keyed by the
        // widget's own questionId), independent of the agent. This and the
        // agent turn have no data dependency (the agent reads the answer off
        // the transcript, not the persist result), so fire them together;
        // persist latency never delays the interactive turn.
        const persist = saveClarifyAnswer(slug, {
          questionId,
          question,
          answer,
        })
          .then((updated) => {
            setRecordedAnswers(
              (updated.clarifyAnswers ?? []).map(toRecordedAnswer),
            )
          })
          .catch(() => {
            // Persist failed. Optimistic `answers` already holds the highlight
            // for the rest of this session, and the answer still rides the
            // transcript for the agent; mirror it into recordedAnswers so the
            // in-session state stays internally consistent. The DB was not
            // written, so a reload will lose the highlight (nothing to restore).
            setRecordedAnswers((prev) =>
              prev.some((a) => a.questionId === questionId)
                ? prev
                : [...prev, { questionId, question, answer }],
            )
          })
        // Release the guard only once BOTH the persist and the agent stream
        // settle, so a tap during the (longer) stream can't open a second one.
        try {
          await Promise.all([send(answer, { hidden: true }), persist])
        } finally {
          answeringRef.current = false
        }
      })()
    },
    [slug, send],
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
          (ordinance.clarifyAnswers ?? []).map(toRecordedAnswer),
        )
        setMessages(history)
        setPhase('ready')
        // Brand-new conversation: let the agent take the first turn.
        if (history.length === 0) {
          void sendRef.current(kickoffFor(step), {
            hidden: true,
            idOverride: id,
          })
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

  const { scrollRef, onScroll } = usePinnedAutoScroll([
    messages,
    visibleSegments,
    liveClarify,
    // The next-step offer is consumed by onEvent (never hits visibleSegments),
    // so include it or the offer widget renders below the fold unscrolled.
    liveOffer,
  ])

  if (phase === 'loading') {
    return (
      <div className="flex h-[calc(100dvh-4rem)] w-full flex-col bg-background lg:h-dvh">
        <div
          className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-4"
          aria-busy="true"
        >
          <header className="flex flex-col gap-3">
            {stepValue ? <OrdinanceStepper current={stepValue} /> : null}
            <Skeleton className="h-7 w-64" />
          </header>
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex max-w-full items-start gap-2 self-start">
              <Skeleton className="size-6 shrink-0 rounded-full" />
              <Skeleton className="h-20 w-80 max-w-full rounded-2xl" />
            </div>
            <div className="flex max-w-full items-start gap-2 self-start">
              <Skeleton className="size-6 shrink-0 rounded-full" />
              <Skeleton className="h-12 w-64 max-w-full rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'error' || !stepValue) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] w-full flex-col bg-background lg:h-dvh">
        <div className="mx-auto flex h-full w-full max-w-3xl flex-1 flex-col items-center justify-center p-6 text-center text-tertiary">
          We couldn&apos;t open this ordinance step. Check the link and try
          again.
        </div>
      </div>
    )
  }

  // Ordered assistant turns that asked a clarify question.
  const clarifyMessages = messages.filter(
    (m) =>
      m.role === 'assistant' &&
      (m.segments ?? []).some((s) => s.toolName === CLARIFY_TOOL),
  )
  // Persisted answers keyed by questionId. The client now writes answers under
  // the widget's own questionId (see saveClarifyAnswer), so this is an exact
  // match, no fragile question-text pairing.
  const recordedByQuestionId = new Map(
    recordedAnswers.map((a) => [a.questionId, a.answer]),
  )
  // Resolve each clarify turn's answer: the optimistic session pick first, else
  // the persisted answer for the same questionId.
  const answerByMessageId: Record<string, string> = {}
  for (const m of clarifyMessages) {
    const q = clarifyFromSegments(m.segments ?? [])
    if (!q) continue
    const resolved =
      answers[q.questionId] ?? recordedByQuestionId.get(q.questionId)
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
      !(m.role === 'user' && KICKOFF_TEXTS.has(m.content)) &&
      !hiddenIds.has(m.id),
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
  const revealedTextLength = segmentsTextLength(visibleSegments)
  const shownWidgets = liveWidgets
    .filter((w) => revealedTextLength >= w.appearAfter)
    .map((w) => w.instance)
  const showWidgets = shownWidgets.length > 0
  // Show the wait shimmer only when the assistant is working but nothing is
  // visible on screen yet, or while a tool's arguments generate. Keying
  // "nothing visible" on the revealed segments (not on the arrival of the first
  // network delta) keeps the shimmer up until the first character actually
  // paints, so there is no empty flash between "Thinking..." and the first
  // word. The tool-generating case is gated on revealDone so the shimmer never
  // overlaps text that is still typing out.
  const nothingVisible = visibleSegments.length === 0 && !showWidgets
  const toolGenerating = generatingTool !== null && revealDone
  const working =
    sending && !showClarify && !showOffer && (nothingVisible || toolGenerating)
  // Name what the model is doing when we know (a tool's args are streaming in);
  // otherwise the generic wait label.
  const workingLabel =
    (generatingTool && GENERATING_LABELS[generatingTool]) || 'Thinking...'

  return (
    <div className="flex h-[calc(100dvh-4rem)] w-full flex-col bg-background lg:h-dvh">
      {/* Everything but the composer scrolls together — the stepper scrolls
          away with the conversation, matching the prototype. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
          <header className="flex flex-col gap-3">
            <OrdinanceStepper current={stepValue} />
            {ordinanceTitle ? (
              <h1 className="text-xl font-semibold text-foreground">
                {ordinanceTitle}
              </h1>
            ) : null}
          </header>

          <div className="flex flex-col gap-3">
            {visibleMessages.map((message) =>
              message.role === 'user' ? (
                <UserBubble key={message.id}>{message.content}</UserBubble>
              ) : (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  slug={slug}
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
                        nextLabel: ORDINANCE_NEXT_STEP_CTA[nextStep],
                      }
                    : {})}
                />
              ),
            )}

            {(visibleSegments.length > 0 ||
              showClarify ||
              showWidgets ||
              working) && (
              <AssistantRow>
                {visibleSegments.length > 0 ? (
                  <InlineSegments
                    segments={visibleSegments}
                    toolLabel={ordinanceToolLabel}
                  />
                ) : null}
                {showWidgets ? (
                  <StepWidgetBlocks widgets={shownWidgets} slug={slug} />
                ) : null}
                {showClarify && liveClarify ? (
                  <ClarifyQuestionWidget
                    question={liveClarify}
                    disabled
                    onAnswer={() => undefined}
                  />
                ) : null}
                {working ? <ThinkingRow label={workingLabel} /> : null}
              </AssistantRow>
            )}

            {showOffer && liveOffer && nextStep ? (
              <NextStepButton
                nextLabel={ORDINANCE_NEXT_STEP_CTA[nextStep]}
                onAdvance={goToNextStep}
              />
            ) : null}

            {streamError ? (
              <p className="text-sm text-destructive">{streamError}</p>
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
              const text = composer
              setComposer('')
              void send(text)
            }}
            disabled={sending}
            dictation={dictation}
          />
        </div>
      </div>
    </div>
  )
}

function NextStepButton({
  nextLabel,
  onAdvance,
}: {
  nextLabel: string
  onAdvance: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onAdvance}
      className="h-auto w-full justify-between rounded-lg border-border bg-card px-4 py-3 text-sm text-foreground shadow-sm hover:border-foreground/20 hover:bg-muted/50 hover:text-foreground"
    >
      <span>{nextLabel}</span>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Button>
  )
}

function AssistantMessage({
  message,
  slug,
  answer,
  interactive,
  onAnswerClarify,
  onAdvance,
  nextLabel,
}: {
  message: ChatMessageDto
  slug: string
  answer?: string
  interactive: boolean
  onAnswerClarify: (
    questionId: string,
    question: string,
    answer: string,
  ) => void
  onAdvance?: () => void
  nextLabel?: string
}): React.JSX.Element {
  const segments = message.segments ?? []
  const clarify = clarifyFromSegments(segments)
  const stepWidgets = parseStepWidgets(segments)
  // Same interleaved model as the live turn: text and tool pills in stream
  // order, so a reloaded turn reads identically to how it streamed.
  const rendered = segmentsToLive(segments, message.content ?? '')

  return (
    <>
      <AssistantRow>
        <InlineSegments segments={rendered} toolLabel={ordinanceToolLabel} />
        <StepWidgetBlocks widgets={stepWidgets} slug={slug} />
        {clarify ? (
          <ClarifyQuestionWidget
            question={clarify}
            disabled={!interactive}
            {...(answer !== undefined ? { answer } : {})}
            onAnswer={(a) =>
              onAnswerClarify(clarify.questionId, clarify.question, a)
            }
          />
        ) : null}
      </AssistantRow>
      {hasOfferSegment(segments) && onAdvance && nextLabel ? (
        <NextStepButton nextLabel={nextLabel} onAdvance={onAdvance} />
      ) : null}
    </>
  )
}
