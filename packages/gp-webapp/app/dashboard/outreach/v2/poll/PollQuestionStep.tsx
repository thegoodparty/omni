import { useEffect, useState, type ReactNode } from 'react'
import {
  POLL_QUESTION_MAX_LENGTH,
  POLL_QUESTION_MIN_LENGTH,
  SMS_COMPOSED_MAX_LENGTH,
  POLL_TONE_VALUES,
  type PollTone,
} from '@goodparty_org/contracts'
import {
  Button,
  Card,
  cn,
  FilterPill,
  FilterPillGroup,
  IconButton,
  seamlessFieldHost,
  TokenField,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@styleguide'
import {
  Loader2Icon,
  MessageSquareIcon,
  MicIcon,
  RefreshIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SmileIcon,
  SparklesIcon,
  SquareIcon,
  SunIcon,
  TargetIcon,
} from '@styleguide/components/ui/icons'
import { useDictationAppend } from 'app/dashboard/shared/dictation/useDictationAppend'
import { Intro } from '../social/Intro'
import { withSampleFirstName } from '../sms/smsCompose.util'
import { pollFooter } from './pollCompose.util'
import { PollImageDropzone } from './PollImageDropzone'
import { POLL_TONE_LABELS, SERVE_POLL_QUESTION_COPY } from './pollCopy'
import type { BiasCheckStatus } from './usePollBiasCheck'

const POLL_TONE_ICONS: Record<PollTone, ReactNode> = {
  Neutral: <MessageSquareIcon className="size-4" />,
  Warm: <SunIcon className="size-4" />,
  Direct: <TargetIcon className="size-4" />,
  Friendly: <SmileIcon className="size-4" />,
}

interface PollQuestionStepProps {
  tone: PollTone
  onToneChange: (tone: PollTone) => void
  question: string
  onQuestionChange: (question: string) => void
  intro: string
  // Who the draft was written for, or null when the official wrote the
  // question themselves and nothing was suggested.
  suggestedFor: string | null
  composedLength: number
  onRegenerate: () => void
  canRegenerate: boolean
  drafting: boolean
  draftError: boolean
  biasStatus: BiasCheckStatus
  flaggedSpans: { phrase: string; reason: string }[]
  onCheckBias: () => void
  onQuestionBlur: () => void
  onImprove: () => void
  improving: boolean
  improveResult: 'error' | 'unchanged' | null
  // Shown once an AI rewrite (Regenerate, a tone, Improve) has replaced
  // the question, until the next edit.
  canUndo: boolean
  onUndo: () => void
  imageUrl: string | undefined
  onImageChange: (url: string | undefined) => void
  // Raised by a Continue press that found something missing, so the reason is
  // shown instead of a dead button.
  showValidation: boolean
}

// Below Tailwind's `sm`. The styleguide's useIsMobile draws its line at `lg`,
// which would move the status out of a desktop toolbar at a 1020px window.
const PHONE_QUERY = '(max-width: 639px)'

const useIsPhone = (): boolean => {
  const [isPhone, setIsPhone] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(PHONE_QUERY)
    const update = () => setIsPhone(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return isPhone
}

// One text is 160 characters; the length is of the composed text, with the
// greeting and opt-out line, since that is what is sent.
const textSegments = (length: number): number =>
  Math.max(1, Math.ceil(length / 160))

export const PollQuestionStep = ({
  tone,
  onToneChange,
  question,
  onQuestionChange,
  intro,
  suggestedFor,
  composedLength,
  onRegenerate,
  canRegenerate,
  drafting,
  draftError,
  biasStatus,
  flaggedSpans,
  onCheckBias,
  onQuestionBlur,
  onImprove,
  improving,
  improveResult,
  canUndo,
  onUndo,
  imageUrl,
  onImageChange,
  showValidation,
}: PollQuestionStepProps) => {
  const trimmedLength = question.trim().length
  const tooShort = trimmedLength < POLL_QUESTION_MIN_LENGTH
  const tooLong = trimmedLength > POLL_QUESTION_MAX_LENGTH
  const busy = drafting || improving
  const dictation = useDictationAppend({
    analyticsLabel: 'outreach-poll-question',
    value: question,
    onChange: onQuestionChange,
  })
  const isRecording = dictation.status === 'recording'
  const isPhone = useIsPhone()

  return (
    <div className="space-y-6">
      <Intro
        channel="poll"
        title={SERVE_POLL_QUESTION_COPY.title}
        body={SERVE_POLL_QUESTION_COPY.body}
      />

      <FilterPillGroup
        type="single"
        value={tone}
        onValueChange={(value) => value && onToneChange(value as PollTone)}
      >
        {POLL_TONE_VALUES.map((value) => (
          <FilterPill
            key={value}
            value={value}
            disabled={drafting || dictation.active}
            className="gap-1.5"
          >
            {POLL_TONE_ICONS[value]}
            {POLL_TONE_LABELS[value]}
          </FilterPill>
        ))}
      </FilterPillGroup>

      {/* The caption wraps under itself so Regenerate keeps its place on the
          first line, rather than dropping to a row of its own on a phone. */}
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {suggestedFor !== null &&
            SERVE_POLL_QUESTION_COPY.suggestedFor(suggestedFor)}
        </p>
        <Button
          type="button"
          variant="link"
          size="small"
          className="h-auto shrink-0 gap-1.5 px-0 py-0 no-underline has-[>svg]:px-0"
          onClick={onRegenerate}
          disabled={drafting || dictation.active || !canRegenerate}
        >
          {drafting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <RefreshIcon className="size-4" />
          )}
          {SERVE_POLL_QUESTION_COPY.regenerate}
        </Button>
      </div>

      <div className="space-y-3">
        {improveResult === 'error' && (
          <Card className="items-start gap-3 border-destructive p-4">
            <p role="alert" className="text-sm text-foreground">
              {SERVE_POLL_QUESTION_COPY.improveError}
            </p>
            <Button type="button" size="small" onClick={onImprove}>
              {SERVE_POLL_QUESTION_COPY.tryAgain}
            </Button>
          </Card>
        )}

        <Card className={cn('gap-0 p-4', seamlessFieldHost)}>
          <PollImageDropzone
            imageUrl={imageUrl}
            onImageChange={onImageChange}
          />

          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {SERVE_POLL_QUESTION_COPY.questionLabel}
            </span>
            <span
              className={cn(
                'text-xs tabular-nums text-muted-foreground',
                composedLength > SMS_COMPOSED_MAX_LENGTH && 'text-destructive',
              )}
            >
              {SERVE_POLL_QUESTION_COPY.count(
                composedLength,
                textSegments(composedLength),
              )}
            </span>
          </div>
          {/* The greeting and opt-out are fixed lines gp-api composes around
              the question, so they sit beside the field, muted, at its type
              size: the three read as the one text that is sent. */}
          <div className="space-y-2">
            <p className="text-base text-muted-foreground max-sm:pb-2 md:text-sm">
              {withSampleFirstName(intro)}
            </p>
            {/* TokenField takes no onBlur; focusout bubbles to this wrapper,
                and focus moving within it is not leaving the field. */}
            <div
              onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return
                onQuestionBlur()
              }}
            >
              <TokenField
                value={question}
                onChange={onQuestionChange}
                // Read-only while a draft or a rewrite is on its way, so
                // nothing typed is overwritten by it.
                readOnly={busy}
                placeholder={
                  drafting
                    ? 'Writing your question…'
                    : SERVE_POLL_QUESTION_COPY.questionPlaceholder
                }
                aria-label="Poll question"
                variant="seamless"
              />
            </div>
            {/* A beat more space above the opt-out than between the other
                lines, and more again around the question on a phone, where
                the wrapped lines otherwise run together, so the editable
                question stays its own block. */}
            <p className="pt-1 text-base text-muted-foreground max-sm:pt-2 md:text-sm">
              {pollFooter}
            </p>
          </div>
          <div className="border-border -mx-4 -mb-4 mt-4 flex items-center justify-end gap-1 border-t p-2">
            {/* On a phone the status keeps its place but drops its words, so
                the toolbar fits on one line; a flag still explains itself in
                the note below the card. */}
            <BiasCheckStatusControl
              status={biasStatus}
              disabled={busy}
              onCheck={onCheckBias}
              iconOnly={isPhone}
              className="mr-auto"
            />
            {canUndo && (
              <Button
                type="button"
                variant="link"
                size="small"
                className="h-auto px-2"
                onClick={onUndo}
              >
                {SERVE_POLL_QUESTION_COPY.undo}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="small"
              className="text-muted-foreground"
              // A rewrite landing mid-dictation would overwrite the words
              // still being dictated, so the AI actions wait for the mic.
              disabled={
                busy || dictation.active || question.trim().length === 0
              }
              onClick={onImprove}
            >
              {improving ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  {SERVE_POLL_QUESTION_COPY.improving}
                </>
              ) : (
                <>
                  <SparklesIcon className="size-4" />
                  {SERVE_POLL_QUESTION_COPY.improve}
                </>
              )}
            </Button>
            <IconButton
              type="button"
              variant={isRecording ? 'destructive' : 'ghost'}
              size="small"
              aria-label={isRecording ? 'Stop dictation' : 'Dictate question'}
              disabled={busy || dictation.status === 'stopping'}
              onClick={() => {
                void dictation.toggle()
              }}
              className={cn(!isRecording && 'text-muted-foreground')}
            >
              {dictation.busy && !isRecording ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden />
              ) : isRecording ? (
                <SquareIcon className="size-4 fill-current" aria-hidden />
              ) : (
                <MicIcon className="size-5" aria-hidden />
              )}
            </IconButton>
          </div>
        </Card>
        {biasStatus === 'flagged' && (
          <div className="space-y-1 text-xs">
            <p className="text-destructive">
              {SERVE_POLL_QUESTION_COPY.biasFlaggedNote}
            </p>
            {flaggedSpans.length > 0 && (
              <ul className="space-y-2 text-muted-foreground">
                {flaggedSpans.map((span) => (
                  // globals.css makes every dashboard <li> a flex row, which
                  // set the phrase and its reason side by side as columns.
                  <li
                    key={`${span.phrase}-${span.reason}`}
                    className="flex flex-col gap-0.5"
                  >
                    <span className="font-medium text-foreground">
                      &ldquo;{span.phrase}&rdquo;
                    </span>
                    <span>{span.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {/* The analyzer can flag a question and still hand it back as it
            was; "already reads clearly" beside "Bias detected" would
            contradict itself, so a flagged one says to edit it instead. */}
        {improveResult === 'unchanged' && (
          <p
            role="status"
            className={cn(
              'text-xs',
              biasStatus === 'flagged'
                ? 'text-destructive'
                : 'text-muted-foreground',
            )}
          >
            {biasStatus === 'flagged'
              ? SERVE_POLL_QUESTION_COPY.improveStuck
              : SERVE_POLL_QUESTION_COPY.improveUnchanged}
          </p>
        )}
        {dictation.status === 'error' && dictation.error !== null && (
          <p className="text-xs text-destructive">
            {SERVE_POLL_QUESTION_COPY.dictationError(dictation.error)}
          </p>
        )}
        {showValidation && tooShort && (
          <p role="alert" className="text-sm text-destructive">
            {SERVE_POLL_QUESTION_COPY.tooShort}
          </p>
        )}
        {tooLong && (
          <p role="alert" className="text-sm text-destructive">
            {SERVE_POLL_QUESTION_COPY.tooLong}
          </p>
        )}
      </div>

      {draftError && (
        <p role="alert" className="text-sm text-destructive">
          {SERVE_POLL_QUESTION_COPY.draftError}
        </p>
      )}
    </div>
  )
}

interface BiasCheckStatusControlProps {
  status: BiasCheckStatus
  disabled: boolean
  onCheck: () => void
  // The words stay for a screen reader.
  iconOnly?: boolean
  className?: string
}

const BiasCheckStatusControl = ({
  status,
  disabled,
  onCheck,
  iconOnly = false,
  className,
}: BiasCheckStatusControlProps) => {
  const label = (text: string) =>
    iconOnly ? <span className="sr-only">{text}</span> : text
  const renderControl = () => {
    if (status === 'passed' || status === 'flagged') {
      const passed = status === 'passed'
      return (
        <span
          role="status"
          tabIndex={iconOnly ? 0 : undefined}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 whitespace-nowrap text-sm font-medium',
            iconOnly ? 'px-2' : 'px-3',
            passed ? 'text-success' : 'text-destructive',
            className,
          )}
        >
          {passed ? (
            <ShieldCheckIcon className="size-4" />
          ) : (
            <ShieldAlertIcon className="size-4" />
          )}
          {label(
            passed
              ? SERVE_POLL_QUESTION_COPY.biasPassed
              : SERVE_POLL_QUESTION_COPY.biasFlagged,
          )}
        </span>
      )
    }
    const checking = status === 'checking'
    const failed = status === 'error'
    return (
      <Button
        type="button"
        variant="ghost"
        size="small"
        className={cn(
          failed ? 'text-destructive' : 'text-muted-foreground',
          iconOnly && 'px-2 has-[>svg]:px-2',
          className,
        )}
        disabled={disabled || checking || status === 'unavailable'}
        onClick={onCheck}
      >
        {checking ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : failed ? (
          <RefreshIcon className="size-4" />
        ) : (
          <ShieldCheckIcon className="size-4" />
        )}
        {label(
          checking
            ? SERVE_POLL_QUESTION_COPY.checkingBias
            : failed
              ? SERVE_POLL_QUESTION_COPY.biasCheckError
              : SERVE_POLL_QUESTION_COPY.checkBias,
        )}
      </Button>
    )
  }
  const control = renderControl()
  if (!iconOnly || status === 'unavailable') return control
  // Tap opens it too: a phone has no hover.
  return (
    <Tooltip openOnClick>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent>
        {SERVE_POLL_QUESTION_COPY.biasTooltip[status]}
      </TooltipContent>
    </Tooltip>
  )
}
