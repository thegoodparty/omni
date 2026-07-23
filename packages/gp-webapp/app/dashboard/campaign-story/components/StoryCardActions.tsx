'use client'

import {
  Button,
  CheckIcon,
  LoaderCircleIcon,
  MicIcon,
  SquareIcon,
} from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import type { UseDictationAppendResult } from 'app/dashboard/briefings/shared/useDictationAppend'
import type { StoryRewrite } from './useStoryRewrite'

interface StoryCardActionsProps {
  // Save sits on the left and appears once there is unsaved content (e.g. after
  // a dictation drops text in). Disabled while clean or mid-save.
  isDirty: boolean
  hasSavedContent: boolean
  isSaving: boolean
  onSave: () => void
  // "Improve with AI" reuses the existing story rewrite; while it runs the label
  // becomes "Improving…", and the improved text drops straight into the field.
  // Once applied, an "Undo" link (left of the button) restores the original.
  // Disabled when there's nothing to improve.
  rewrite: StoryRewrite
  improveDisabled: boolean
  // Voice capture: tap the mic to record, tap again (red stop) to stop; the
  // transcript is dropped into the field by the hook's onChange.
  dictation: UseDictationAppendResult
}

// The bar under a story card's textarea: Save (left, when dirty) + an Undo link
// (after an AI improvement) + Improve with AI + a mic. Mirrors the outreach
// compose bar; shared by the why + background cards so the two look identical.
export default function StoryCardActions({
  isDirty,
  hasSavedContent,
  isSaving,
  onSave,
  rewrite,
  improveDisabled,
  dictation,
}: StoryCardActionsProps): React.JSX.Element {
  const isRecording = dictation.status === 'recording'
  const showSave = isDirty || hasSavedContent

  return (
    <div className="flex flex-col gap-2">
      {(dictation.error || dictation.partialTranscript) && (
        <p className="text-sm">
          {dictation.error ? (
            <span className="text-destructive">{dictation.error}</span>
          ) : (
            <span className="italic text-muted-foreground">
              {dictation.partialTranscript}
            </span>
          )}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          {showSave && (
            <Button
              variant="outline"
              size="small"
              icon={hasSavedContent && !isDirty ? <CheckIcon /> : undefined}
              loading={isSaving}
              loadingText="Saving…"
              disabled={!isDirty || isSaving}
              onClick={onSave}
            >
              {hasSavedContent && !isDirty ? 'Saved' : 'Save'}
            </Button>
          )}
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
    </div>
  )
}
