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
import {
  AssistantMarkdown,
  AssistantRow,
  ToolPill,
} from '../../shared/agent-chat/chatUI'
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

const toolPills = (segments: ChatMessageSegment[]): string[] =>
  segments.flatMap((s) => {
    const label =
      s.kind === 'tool' && s.toolName ? TOOL_LABELS[s.toolName] : undefined
    return label ? [label] : []
  })

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
  const [liveText, setLiveText] = useState('')
  const [liveTools, setLiveTools] = useState<string[]>([])
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
      setLiveText('')
      setLiveTools([])
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

      try {
        for await (const event of ordinanceFlowChatApi.streamMessage({
          conversationId: id,
          content: trimmed,
          clientMessageId: crypto.randomUUID(),
        })) {
          if (event.type === 'text') {
            setLiveText((prev) => prev + event.delta)
          } else if (event.type === 'tool_call') {
            if (event.toolName === CLARIFY_TOOL) {
              const parsed = parseClarify(event.args)
              if (parsed) setLiveClarify(parsed)
            } else if (event.toolName === OFFER_TOOL) {
              setLiveOffer(parseOffer(event.args) ?? {})
            } else {
              const label = TOOL_LABELS[event.toolName]
              if (label) setLiveTools((prev) => [...prev, label])
            }
          } else if (event.type === 'error') {
            setStreamError(event.message)
          }
        }
        const history = await ordinanceFlowChatApi.listMessages(id)
        setMessages(history)
      } catch {
        setStreamError('Something went wrong. Please try again.')
      } finally {
        setLiveText('')
        setLiveTools([])
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
  }, [messages, liveText, liveClarify])

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
  // Show a working shimmer for the whole in-flight turn until a widget/button
  // appears — this covers the gap where the model composes the tool call after
  // streaming its lead-in (there is no tool event during it).
  const working = sending && !liveClarify && !liveOffer

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

          {(liveText || liveTools.length > 0 || liveClarify || working) && (
            <AssistantRow>
              {liveTools.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {liveTools.map((label, i) => (
                    <ToolPill key={`live-tool-${i}`} label={label} running />
                  ))}
                </div>
              ) : null}
              {liveText ? (
                <AssistantMarkdown>{liveText}</AssistantMarkdown>
              ) : null}
              {liveClarify ? (
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

          {liveOffer && nextStep ? (
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
  const pills = toolPills(segments)
  const clarify = clarifyFromSegments(segments)
  const textBlocks = segments
    .filter((s) => s.kind === 'text' && s.text)
    .map((s) => s.text ?? '')
  const body = textBlocks.length > 0 ? textBlocks.join('\n\n') : message.content

  return (
    <>
      <AssistantRow>
        {pills.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {pills.map((label, i) => (
              <ToolPill key={`tool-${i}`} label={label} />
            ))}
          </div>
        ) : null}
        {body ? <AssistantMarkdown>{body}</AssistantMarkdown> : null}
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
