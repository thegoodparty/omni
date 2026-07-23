'use client'

import { Button, LoaderCircleIcon, MicIcon, SquareIcon } from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import type { UseDictationAppendResult } from 'app/dashboard/briefings/shared/useDictationAppend'
import type { StoryRewrite } from 'app/dashboard/campaign-story/components/useStoryRewrite'

interface StoryFieldBarProps {
  rewrite: StoryRewrite
  dictation: UseDictationAppendResult
  improveDisabled: boolean
}

// The action bar under a story field: an AI-rewrite error/limit notice, then a
// row with "● Listening…" (while recording) on the left and Undo (after an
// improvement) + Improve with AI + a mic on the right. Shared by the onboarding
// story-intake card and each policy-issue row so they behave identically.
export default function StoryFieldBar({
  rewrite,
  dictation,
  improveDisabled,
}: StoryFieldBarProps): React.JSX.Element {
  const isRecording = dictation.status === 'recording'

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
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

      <div className="flex items-center justify-between gap-3">
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
              className="h-auto p-0 no-underline hover:underline"
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
    </div>
  )
}
