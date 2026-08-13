'use client'

import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '@styleguide'
import type { ScriptIssue } from './doorScriptContent'

interface DoorScriptProps {
  intro: string
  issues: ScriptIssue[]
}

// Collapsed by default: a canvasser who knows their own issues shouldn't have to
// scroll past them to reach the answer pills, and the sheet is a phone screen.
export default function DoorScript({ intro, issues }: DoorScriptProps) {
  const [open, setOpen] = useState(false)

  // Nothing the candidate wrote, so nothing to say. An empty card would read as
  // a broken feature; the issues editor is where this gets fixed, not here.
  if (!intro && issues.length === 0) return null

  return (
    <section className="rounded-md border border-border">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-info">
          Your talking points
        </span>
        {open ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3 text-sm">
          {intro && <p>{intro}</p>}
          {/* Two stances can hang off one top issue, so the title is not a
              unique key. The list is static for the length of a walk — it is
              built once from the campaign, never reordered or spliced — so the
              position is a safe tiebreak. */}
          {issues.map((issue, index) => (
            <div key={`${issue.title}-${index}`}>
              <p className="text-xs font-medium text-muted-foreground">
                {issue.title}
              </p>
              <p>{issue.body}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
