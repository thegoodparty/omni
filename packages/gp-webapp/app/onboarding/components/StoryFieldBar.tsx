'use client'

import {
  Button,
  CheckIcon,
  IconButton,
  LoaderCircleIcon,
  MicIcon,
  SquareIcon,
  cn,
} from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import type { UseDictationAppendResult } from 'app/(dashboard)/shared/dictation/useDictationAppend'
import type { StoryRewrite } from 'app/(dashboard)/campaign-story/components/useStoryRewrite'

// Optional per-field Save. Passed on the standalone "Your Story" dashboard page
// (each card persists on its own); omitted in onboarding, where the whole story
// is deferred to one save on the final step.
export interface StorySaveState {
  isDirty: boolean
  isSaving: boolean
  hasSavedContent: boolean
  onSave: () => void
}

interface StoryFieldBarProps {
  rewrite: StoryRewrite
  dictation: UseDictationAppendResult
  improveDisabled: boolean
  save?: StorySaveState
}

// The action bar under a story field: an AI-rewrite error/limit notice, then a
// row with "● Listening…" (while recording) on the left and Undo (after an
// improvement) + Improve with AI + a mic on the right. Shared by the onboarding
// story-intake card and each policy-issue row so they behave identically.
export default function StoryFieldBar({
  rewrite,
  dictation,
  improveDisabled,
  save,
}: StoryFieldBarProps): React.JSX.Element {
  // 'stopping' = the server is flushing whatever was still being transcribed
  // after the user hit stop, so show "Transcribing…" until it lands. Every
  // other active state (requesting_mic → connecting → recording) reads as
  // "Listening…" so the recording UI appears the instant the mic is tapped,
  // with no wait for the socket to come up.
  const isStopping = dictation.status === 'stopping'
  const isCapturing = dictation.active && !isStopping

  return (
    // The same footer as the outreach compose cards: full card width under a
    // rule, breaking out of the card's p-4, with quiet ghost actions on the
    // right.
    <div className="-mx-4 -mb-4 mt-1 flex flex-col gap-2 border-t border-border p-2">
      {rewrite.rewriteError && (
        <p className="px-2 text-sm text-destructive">
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
        <p className="px-2 text-sm text-muted-foreground">
          You&apos;ve reached your AI rewrite limit for this campaign. You can
          still edit your answer yourself.
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 px-2">
          {save && (
            <Button
              variant="outline"
              size="small"
              icon={
                save.hasSavedContent && !save.isDirty ? (
                  <CheckIcon />
                ) : undefined
              }
              loading={save.isSaving}
              loadingText="Saving…"
              disabled={!save.isDirty || save.isSaving}
              onClick={save.onSave}
            >
              {save.hasSavedContent && !save.isDirty ? 'Saved' : 'Save'}
            </Button>
          )}
          {isStopping ? (
            <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
              Transcribing…
            </span>
          ) : isCapturing ? (
            <span className="flex items-center gap-2 text-sm font-medium text-info">
              <span className="relative flex size-2.5" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-info opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-info" />
              </span>
              Listening…
            </span>
          ) : dictation.error ? (
            <span className="text-sm text-destructive">{dictation.error}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {rewrite.canUndo && !rewrite.isRewriting && (
            <Button
              type="button"
              variant="link"
              size="small"
              className="h-auto px-2"
              onClick={rewrite.undo}
            >
              Undo
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="small"
            className="text-muted-foreground"
            disabled={
              rewrite.isRewriting || improveDisabled || rewrite.limitReached
            }
            onClick={() => void rewrite.requestRewrite()}
          >
            {rewrite.isRewriting ? (
              <>
                <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
                Improving…
              </>
            ) : (
              <>
                <SparklesIcon className="size-4" aria-hidden />
                Improve with AI
              </>
            )}
          </Button>

          <IconButton
            type="button"
            variant={dictation.active ? 'destructive' : 'ghost'}
            size="small"
            aria-label={dictation.active ? 'Stop recording' : 'Record voice'}
            // Live through requesting_mic/connecting/recording so the stop
            // control responds immediately; only the flush window
            // ('stopping') disables it.
            disabled={isStopping}
            onClick={() => void dictation.toggle()}
            className={cn(!dictation.active && 'text-muted-foreground')}
          >
            {isStopping ? (
              <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            ) : dictation.active ? (
              <SquareIcon className="size-4 fill-current" aria-hidden />
            ) : (
              <MicIcon className="size-5" aria-hidden />
            )}
          </IconButton>
        </div>
      </div>
    </div>
  )
}
