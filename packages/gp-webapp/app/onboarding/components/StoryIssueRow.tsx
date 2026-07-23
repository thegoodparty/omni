'use client'

import { Card, Input, Label, Textarea } from '@styleguide'
import { XMarkIcon } from '@styleguide/components/ui/icons'
import type { WebsiteIssue } from 'helpers/types'
import { useDictationAppend } from 'app/dashboard/briefings/shared/useDictationAppend'
import { useStoryRewrite } from 'app/dashboard/campaign-story/components/useStoryRewrite'
import StoryFieldBar from './StoryFieldBar'

interface StoryIssueRowProps {
  index: number
  issue: WebsiteIssue
  onChange: (issue: WebsiteIssue) => void
  onRemove: () => void
}

const TITLE_PLACEHOLDER =
  'e.g. Safe streets, affordable housing, reliable transit'
const DESCRIPTION_PLACEHOLDER =
  "e.g. We lost the northside bus route last year and I watched three neighbors lose jobs because they couldn't get to work. I want safe streets, affordable housing, and a transit system that doesn't leave anyone behind."

// One policy priority in the onboarding voter-issues step: a "Priority N" card
// with a title field and a description textarea, with the shared record +
// "Improve with AI" bar under it. Deferred-save (the parent persists on the
// final story step). Replaces the old modal-based add flow.
export default function StoryIssueRow({
  index,
  issue,
  onChange,
  onRemove,
}: StoryIssueRowProps): React.JSX.Element {
  const setDescription = (description: string): void =>
    onChange({ ...issue, description })
  const rewrite = useStoryRewrite(
    'issue',
    issue.description.trim(),
    setDescription,
    issue.title,
  )
  const dictation = useDictationAppend({
    analyticsLabel: `onboarding_story_issue_${index}`,
    value: issue.description,
    onChange: setDescription,
  })

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-foreground">
          Priority {index + 1}
        </h3>
        <button
          type="button"
          aria-label="Remove policy priority"
          onClick={onRemove}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-grayscale-100 hover:text-foreground"
        >
          <XMarkIcon className="size-4" aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Title</Label>
        <Input
          value={issue.title}
          onChange={(event) =>
            onChange({ ...issue, title: event.target.value })
          }
          placeholder={TITLE_PLACEHOLDER}
          className="placeholder:italic placeholder:text-muted-foreground"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Description</Label>
        <div className="flex flex-col gap-2">
          <Textarea
            value={issue.description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={DESCRIPTION_PLACEHOLDER}
            className="min-h-28 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 placeholder:italic placeholder:text-muted-foreground"
          />
          <span className="self-end text-sm text-muted-foreground">
            {issue.description.length} chars
          </span>
        </div>
      </div>

      <StoryFieldBar
        rewrite={rewrite}
        dictation={dictation}
        improveDisabled={issue.description.trim().length === 0}
      />
    </Card>
  )
}
