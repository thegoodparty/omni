'use client'

import { Button } from '@styleguide'
import { PlusIcon } from '@styleguide/components/ui/icons'
import type { WebsiteIssue } from 'helpers/types'
import StoryIssueRow from './StoryIssueRow'

interface StoryIssuesCardProps {
  issues: WebsiteIssue[]
  onChange: (issues: WebsiteIssue[]) => void
}

// The onboarding voter-issues step: an inline list of policy rows (title +
// description + record/Improve bar) instead of a modal. "Add issue" appends a
// blank row. Controlled + deferred — the parent persists on the final step.
export default function StoryIssuesCard({
  issues,
  onChange,
}: StoryIssuesCardProps): React.JSX.Element {
  const updateAt = (index: number, next: WebsiteIssue): void =>
    onChange(issues.map((issue, i) => (i === index ? next : issue)))
  const removeAt = (index: number): void =>
    onChange(issues.filter((_, i) => i !== index))
  const add = (): void => onChange([...issues, { title: '', description: '' }])

  return (
    <div className="flex flex-col gap-4">
      {issues.map((issue, index) => (
        <StoryIssueRow
          // No stable id on WebsiteIssue; the list is short and only appended
          // to / removed from, so the index key is acceptable here.
          key={index}
          index={index}
          issue={issue}
          onChange={(next) => updateAt(index, next)}
          onRemove={() => removeAt(index)}
        />
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={add}
        className="self-start gap-1.5"
      >
        <PlusIcon className="size-4" aria-hidden />
        Add issue
      </Button>
    </div>
  )
}
