'use client'

import { useRef, useState } from 'react'
import { PlusIcon } from '@styleguide/components/ui/icons'
import type { WebsiteIssue } from 'helpers/types'
import StoryIssueRow from './StoryIssueRow'
import type { StorySaveState } from './StoryFieldBar'

interface StoryIssuesCardProps {
  issues: WebsiteIssue[]
  onChange: (issues: WebsiteIssue[]) => void
  // Section-level Save (dashboard only), shared by every priority row since the
  // issues persist as one array. Omitted in onboarding (deferred).
  save?: StorySaveState
}

// The onboarding voter-issues step: an inline list of "Priority N" cards (title
// + description + record/Improve bar) instead of a modal, with a dashed
// "Add a policy priority" block that appends a blank one. Controlled + deferred
// — the parent persists on the final story step.
export default function StoryIssuesCard({
  issues,
  onChange,
  save,
}: StoryIssuesCardProps): React.JSX.Element {
  // WebsiteIssue has no id, so track a stable render key per row (assigned on
  // mount + on add) alongside the controlled array. An index key would let a
  // removed row's per-row hook state (the rewrite undo baseline, dictation)
  // bleed onto the row that shifts up into its slot — e.g. undo overwriting the
  // wrong issue. Every mutation goes through these handlers, so `keys` stays
  // aligned with `issues`.
  const nextKey = useRef(issues.length)
  const [keys, setKeys] = useState<number[]>(() => issues.map((_, i) => i))

  const updateAt = (index: number, next: WebsiteIssue): void =>
    onChange(issues.map((issue, i) => (i === index ? next : issue)))
  const removeAt = (index: number): void => {
    onChange(issues.filter((_, i) => i !== index))
    setKeys((current) => current.filter((_, i) => i !== index))
  }
  const add = (): void => {
    onChange([...issues, { title: '', description: '' }])
    setKeys((current) => [...current, nextKey.current++])
  }

  return (
    <div className="flex flex-col gap-4">
      {issues.map((issue, index) => (
        <StoryIssueRow
          key={keys[index] ?? index}
          index={index}
          issue={issue}
          onChange={(next) => updateAt(index, next)}
          onRemove={() => removeAt(index)}
          save={save}
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
