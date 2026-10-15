'use client'

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
  RefreshIcon,
  TriangleAlertIcon,
} from '@styleguide/components/ui/icons'
import PollTextBiasInput, {
  type BiasAnalysisState,
} from 'app/dashboard/polls/shared/components/poll-text-bias/PollTextBiasInput'
import { PollImageUpload } from 'app/dashboard/polls/components/PollImageUpload'
import { Intro } from '../social/Intro'
import { pollFooter } from './pollCompose.util'
import { POLL_TONE_LABELS, SERVE_POLL_QUESTION_COPY } from './pollCopy'

interface PollQuestionStepProps {
  tone: PollTone
  onToneChange: (tone: PollTone) => void
  question: string
  onQuestionChange: (question: string) => void
  intro: string
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
  const tooLong = question.length > POLL_QUESTION_MAX_LENGTH

  return (
    <div className="space-y-6">
      <Intro
        channel="poll"
        title={SERVE_POLL_QUESTION_COPY.title}
        body={SERVE_POLL_QUESTION_COPY.body}
      />

      <div className="space-y-2">
        <Label>{SERVE_POLL_QUESTION_COPY.questionLabel}</Label>
        <Card className="gap-3 p-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {SERVE_POLL_QUESTION_COPY.introLabel}
            </span>{' '}
            {intro}
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
        </Card>
        <p className="text-xs text-muted-foreground">
          {SERVE_POLL_QUESTION_COPY.count(
            composedLength,
            textSegments(composedLength),
          )}
        </p>
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterPillGroup
          type="single"
          value={tone}
          onValueChange={(value) => value && onToneChange(value as PollTone)}
        >
          {POLL_TONE_VALUES.map((value) => (
            <FilterPill key={value} value={value} disabled={drafting}>
              {POLL_TONE_LABELS[value]}
            </FilterPill>
          ))}
        </FilterPillGroup>
        <Button
          type="button"
          variant="outline"
          onClick={onRegenerate}
          disabled={drafting || !canRegenerate}
        >
          <RefreshIcon className="size-4" />
          {SERVE_POLL_QUESTION_COPY.regenerate}
        </Button>
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

      <div className="space-y-1">
        <Label>{SERVE_POLL_QUESTION_COPY.imageLabel}</Label>
        <PollImageUpload imageUrl={imageUrl} onUploaded={onImageUploaded} />
      </div>
    </div>
  )
}
