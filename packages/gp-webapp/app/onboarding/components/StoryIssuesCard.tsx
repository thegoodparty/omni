'use client'

import { PlusIcon } from '@styleguide/components/ui/icons'
import type { WebsiteIssue } from 'helpers/types'
import StoryIssueRow from './StoryIssueRow'

interface StoryIssuesCardProps {
  issues: WebsiteIssue[]
  onChange: (issues: WebsiteIssue[]) => void
}

// The onboarding voter-issues step: an inline list of "Priority N" cards (title
// + description + record/Improve bar) instead of a modal, with a dashed
// "Add a policy priority" block that appends a blank one. Controlled + deferred
// — the parent persists on the final story step.
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

      <button
        type="button"
        onClick={add}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-4 text-base font-medium text-link transition-colors hover:border-link hover:bg-link/5"
      >
        <PlusIcon className="size-5" aria-hidden />
        Add a policy priority
      </button>
    </div>
  )
}
