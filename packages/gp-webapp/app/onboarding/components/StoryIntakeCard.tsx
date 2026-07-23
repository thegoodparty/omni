'use client'

import {
  Button,
  Card,
  LoaderCircleIcon,
  MicIcon,
  SquareIcon,
  Textarea,
} from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import { useDictationAppend } from 'app/dashboard/briefings/shared/useDictationAppend'
import {
  useStoryRewrite,
  type StoryRewriteField,
} from 'app/dashboard/campaign-story/components/useStoryRewrite'

interface StoryIntakeCardProps {
  question: string
  // Shown as the italic gray placeholder inside the empty field ("e.g. …").
  examplePlaceholder: string
  value: string
  onChange: (value: string) => void
  rewriteField: StoryRewriteField
  analyticsLabel: string
}

// The onboarding story-intake card (Why / Background steps). Deferred-save: it
// never persists — the parent collects the value and saves everything on the
// final step. "Improve with AI" applies in place (no suggestion panel) with an
// Undo, and the mic dictates into the field. Mirrors the Lovable design: bold
// question, borderless textarea with the example as an italic placeholder, a
// char counter, then an action bar (Listening… on the left while recording).
export default function StoryIntakeCard({
  question,
  examplePlaceholder,
  value,
  onChange,
  rewriteField,
  analyticsLabel,
}: StoryIntakeCardProps): React.JSX.Element {
  const rewrite = useStoryRewrite(rewriteField, value.trim(), onChange)
  const dictation = useDictationAppend({ analyticsLabel, value, onChange })
  const isRecording = dictation.status === 'recording'
  const improveDisabled = value.trim().length === 0

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-2xl font-bold text-foreground">{question}</h2>

      <div className="flex flex-col gap-2">
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={examplePlaceholder}
          className="min-h-40 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 placeholder:italic placeholder:text-muted-foreground"
        />
        <span className="self-end text-sm text-muted-foreground">
          {value.length} chars
        </span>
      </div>

      {rewrite.rewriteError && (
        <p className="text-sm text-destructive">
          Couldn&apos;t generate a rewrite.{' '}
          <Button
            variant="link"
            size="small"
            className="h-auto p-0"
            onClick={() => void rewrite.requestRewrite()}
          >
            Try again
          </Button>
        </p>
      )}

      {rewrite.limitReached && (
        <p className="text-sm text-muted-foreground">
          You&apos;ve reached your AI rewrite limit for this campaign. You can
          still edit your answer yourself.
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          {isRecording ? (
            <span className="flex items-center gap-2 text-sm font-medium text-info">
              <span className="size-2 rounded-full bg-info" aria-hidden />
              Listening…
            </span>
          ) : dictation.error ? (
            <span className="text-sm text-destructive">{dictation.error}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {rewrite.canUndo && !rewrite.isRewriting && (
            <Button
              variant="link"
              size="small"
              className="h-auto p-0"
              onClick={rewrite.undo}
            >
              Undo
            </Button>
          )}

          {rewrite.isRewriting ? (
            <span className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
              Improving…
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void rewrite.requestRewrite()}
              disabled={improveDisabled || rewrite.limitReached}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-grayscale-100 disabled:pointer-events-none disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <SparklesIcon className="size-4" aria-hidden />
              Improve with AI
            </button>
          )}

          {isRecording ? (
            <button
              type="button"
              aria-label="Stop recording"
              onClick={() => void dictation.toggle()}
              disabled={dictation.busy}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-500 text-white disabled:opacity-50"
            >
              <SquareIcon className="size-4" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Record voice"
              disabled={dictation.busy}
              onClick={() => void dictation.toggle()}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-grayscale-100 disabled:pointer-events-none disabled:opacity-50"
            >
              {dictation.busy ? (
                <LoaderCircleIcon className="size-5 animate-spin" aria-hidden />
              ) : (
                <MicIcon className="size-5" aria-hidden />
              )}
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}
