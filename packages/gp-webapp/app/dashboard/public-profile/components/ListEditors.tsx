'use client'

import type { JSX } from 'react'
import { Button, Input, Label, Textarea } from '@styleguide'
import { Plus, Trash2 } from 'lucide-react'
import type {
  PersonProfileAccomplishment,
  PersonProfileRecentExperienceItem,
} from '../shared/types'

// Recent Experience (§4): seeded in-product from the election-api spine, then
// editable. Rows sourced from BallotReady are tagged so the owner can see what
// was auto-populated vs. what they authored.
export function RecentExperienceEditor({
  value,
  onChange,
  disabled,
}: {
  value: PersonProfileRecentExperienceItem[]
  onChange: (next: PersonProfileRecentExperienceItem[]) => void
  disabled?: boolean
}): JSX.Element {
  const update = (
    index: number,
    patch: Partial<PersonProfileRecentExperienceItem>,
  ): void => {
    onChange(
      value.map((row, i) =>
        i === index ? { ...row, ...patch, source: 'user' } : row,
      ),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {value.map((row, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`exp-title-${index}`}>Title</Label>
                <Input
                  id={`exp-title-${index}`}
                  value={row.title}
                  disabled={disabled}
                  placeholder="City Council Member"
                  onChange={(e) => update(index, { title: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`exp-org-${index}`}>Organization</Label>
                <Input
                  id={`exp-org-${index}`}
                  value={row.organization ?? ''}
                  disabled={disabled}
                  placeholder="City of Maplewood"
                  onChange={(e) =>
                    update(index, { organization: e.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`exp-term-${index}`}>Term / dates</Label>
                <Input
                  id={`exp-term-${index}`}
                  value={row.term ?? ''}
                  disabled={disabled}
                  placeholder="2022 – 2026"
                  onChange={(e) => update(index, { term: e.target.value })}
                />
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="small"
              aria-label="Remove experience"
              disabled={disabled}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {row.source === 'ballotready' && (
            <p className="text-xs text-gray-500">
              Auto-filled from public records. Editing keeps your version.
            </p>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="small"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...value,
            { title: '', organization: '', term: '', source: 'user' },
          ])
        }
      >
        <Plus className="mr-1 h-4 w-4" /> Add experience
      </Button>
    </div>
  )
}

// Accomplishments (Serve §4). Rendered on the public profile with a constant
// "Resolved" tag, so there is no per-item status here.
export function AccomplishmentsEditor({
  value,
  onChange,
  disabled,
}: {
  value: PersonProfileAccomplishment[]
  onChange: (next: PersonProfileAccomplishment[]) => void
  disabled?: boolean
}): JSX.Element {
  const update = (
    index: number,
    patch: Partial<PersonProfileAccomplishment>,
  ): void => {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  return (
    <div className="flex flex-col gap-4">
      {value.map((row, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`acc-title-${index}`}>Title</Label>
                <Input
                  id={`acc-title-${index}`}
                  value={row.title}
                  disabled={disabled}
                  placeholder="Passed the tree-canopy ordinance"
                  onChange={(e) => update(index, { title: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`acc-date-${index}`}>Date</Label>
                <Input
                  id={`acc-date-${index}`}
                  value={row.date ?? ''}
                  disabled={disabled}
                  placeholder="March 2026"
                  onChange={(e) => update(index, { date: e.target.value })}
                />
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="small"
              aria-label="Remove accomplishment"
              disabled={disabled}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`acc-desc-${index}`}>Description</Label>
            <Textarea
              id={`acc-desc-${index}`}
              rows={2}
              value={row.description ?? ''}
              disabled={disabled}
              placeholder="What changed and who it helped."
              onChange={(e) => update(index, { description: e.target.value })}
            />
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="small"
        disabled={disabled}
        onClick={() =>
          onChange([...value, { title: '', description: '', date: '' }])
        }
      >
        <Plus className="mr-1 h-4 w-4" /> Add accomplishment
      </Button>
    </div>
  )
}
