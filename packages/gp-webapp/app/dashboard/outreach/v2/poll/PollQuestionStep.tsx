import type { ReactNode } from 'react'
import {
  POLL_QUESTION_MAX_LENGTH,
  POLL_QUESTION_MIN_LENGTH,
  POLL_TONE_VALUES,
  type PollTone,
} from '@goodparty_org/contracts'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  FilterPill,
  FilterPillGroup,
  Label,
} from '@styleguide'
import {
  Loader2Icon,
  MessageSquareIcon,
  RefreshIcon,
  SmileIcon,
  SunIcon,
  TargetIcon,
  TriangleAlertIcon,
} from '@styleguide/components/ui/icons'
import PollTextBiasInput, {
  type BiasAnalysisState,
} from 'app/dashboard/polls/shared/components/poll-text-bias/PollTextBiasInput'
import { PollImageUpload } from 'app/dashboard/polls/components/PollImageUpload'
import { Intro } from '../social/Intro'
import { withSampleFirstName } from '../sms/smsCompose.util'
import { pollFooter } from './pollCompose.util'
import { POLL_TONE_LABELS, SERVE_POLL_QUESTION_COPY } from './pollCopy'

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
  onBiasChange: (state: BiasAnalysisState) => void
  biasFlagged: boolean
  imageUrl: string | undefined
  onImageUploaded: (url: string) => void
  // Raised by a Continue press that found something missing, so the reason is
  // shown instead of a dead button.
  showValidation: boolean
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
  onBiasChange,
  biasFlagged,
  imageUrl,
  onImageUploaded,
  showValidation,
}: PollQuestionStepProps) => {
  const trimmedLength = question.trim().length
  const tooShort = trimmedLength < POLL_QUESTION_MIN_LENGTH
  const tooLong = trimmedLength > POLL_QUESTION_MAX_LENGTH

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
            disabled={drafting}
            className="gap-1.5"
          >
            {POLL_TONE_ICONS[value]}
            {POLL_TONE_LABELS[value]}
          </FilterPill>
        ))}
      </FilterPillGroup>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {suggestedFor !== null &&
            SERVE_POLL_QUESTION_COPY.suggestedFor(suggestedFor)}
        </p>
        <Button
          type="button"
          variant="link"
          size="small"
          className="h-auto gap-1.5 px-0 no-underline"
          onClick={onRegenerate}
          disabled={drafting || !canRegenerate}
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
        <Card className="gap-0 p-4">
          <div className="mb-4 space-y-2">
            <Label>{SERVE_POLL_QUESTION_COPY.imageLabel}</Label>
            <PollImageUpload imageUrl={imageUrl} onUploaded={onImageUploaded} />
          </div>

          <div className="mb-2 flex items-center justify-between">
            <Label>{SERVE_POLL_QUESTION_COPY.questionLabel}</Label>
            <span className="text-xs text-muted-foreground">
              {SERVE_POLL_QUESTION_COPY.count(
                composedLength,
                textSegments(composedLength),
              )}
            </span>
          </div>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {SERVE_POLL_QUESTION_COPY.introLabel}
              </span>{' '}
              {withSampleFirstName(intro)}
            </p>
            {drafting ? (
              <div
                role="status"
                className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
              >
                <Loader2Icon className="size-4 animate-spin" />
                Writing your question…
              </div>
            ) : (
              <PollTextBiasInput
                value={question}
                onChange={onQuestionChange}
                placeholder={SERVE_POLL_QUESTION_COPY.questionPlaceholder}
                onBiasAnalysisChange={onBiasChange}
              />
            )}
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {SERVE_POLL_QUESTION_COPY.footerLabel}
              </span>{' '}
              {pollFooter}
            </p>
          </div>
        </Card>
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

      {biasFlagged && (
        <Alert icon={<TriangleAlertIcon className="size-4" />}>
          <AlertTitle>{SERVE_POLL_QUESTION_COPY.biasAlertTitle}</AlertTitle>
          <AlertDescription>
            {SERVE_POLL_QUESTION_COPY.biasAlertBody}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
