'use client'

import {
  Button,
  CheckIcon,
  LoaderCircleIcon,
  WandSparklesIcon,
  XMarkIcon,
} from '@styleguide'
import type { StoryRewrite } from './useStoryRewrite'

interface RewriteSuggestionProps {
  rewrite: StoryRewrite
}

// The AI "Help me rewrite" suggestion panel: a loading/error/draft body plus
// Discard / Try again / Use this. Shared by the story prompt cards (why,
// background) so the suggestion UI stays identical; each card owns the
// "Help me rewrite" trigger and applies the accepted text to its own editor.
const RewriteSuggestion = ({
  rewrite: {
    isRewriting,
    rewrite,
    rewriteError,
    requestRewrite,
    discard,
    accept,
  },
}: RewriteSuggestionProps): React.JSX.Element => (
  <div className="flex flex-col gap-3 rounded-lg border border-primary bg-primary/5 p-4">
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary">
        <WandSparklesIcon className="size-4" />
        Suggested rewrite
      </span>
      <span className="text-sm text-muted-foreground">
        From your Campaign Manager
      </span>
    </div>

    {isRewriting ? (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin text-primary" />
        Your Campaign Manager is writing a draft&hellip;
      </p>
    ) : rewriteError ? (
      <p className="text-sm text-destructive">
        Couldn&apos;t generate a rewrite. Please try again.
      </p>
    ) : (
      <p className="whitespace-pre-wrap text-base text-foreground">{rewrite}</p>
    )}

    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <Button
        variant="outline"
        icon={<XMarkIcon />}
        onClick={discard}
        disabled={isRewriting}
      >
        Discard
      </Button>
      <Button
        variant="outline"
        icon={<WandSparklesIcon />}
        onClick={() => requestRewrite('retry')}
        disabled={isRewriting}
      >
        Try again
      </Button>
      <Button
        icon={<CheckIcon />}
        onClick={accept}
        disabled={isRewriting || !rewrite}
      >
        Use this
      </Button>
    </div>
  </div>
)

export default RewriteSuggestion
