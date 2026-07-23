'use client'

import { Input, Textarea } from '@styleguide'
import { Trash2Icon } from '@styleguide/components/ui/icons'
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

// One policy in the onboarding voter-issues step: a title field and a
// description textarea with the shared record + "Improve with AI" bar under it.
// Deferred-save (the parent persists on the final story step). Replaces the old
// modal-based add flow — issues are edited inline, one row each.
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
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Input
          value={issue.title}
          onChange={(event) =>
            onChange({ ...issue, title: event.target.value })
          }
          placeholder="Policy title (e.g. Fully fund our schools)"
          className="flex-1"
        />
        <button
          type="button"
          aria-label="Remove policy"
          onClick={onRemove}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-grayscale-100 hover:text-destructive"
        >
          <Trash2Icon className="size-4" aria-hidden />
        </button>
      </div>

      <Textarea
        value={issue.description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Describe this policy in your own words…"
        className="min-h-24 resize-none placeholder:italic placeholder:text-muted-foreground"
      />

      <StoryFieldBar
        rewrite={rewrite}
        dictation={dictation}
        improveDisabled={issue.description.trim().length === 0}
      />
    </div>
  )
}
