'use client'

import type { JSX } from 'react'
import { Button, Switch } from '@styleguide'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { PersonProfileIssueStatus } from '../shared/types'

export interface PriorityRow {
  issueId: string
  title: string
  description: string
  visible: boolean
  status: PersonProfileIssueStatus | null
}

const STATUS_OPTIONS: Array<{
  value: PersonProfileIssueStatus
  label: string
}> = [
  { value: 'PRIORITIZED', label: 'Prioritized' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ONGOING', label: 'Ongoing' },
  { value: 'RESOLVED', label: 'Resolved' },
]

// Owner picks which Serve priorities appear on the public profile, in what
// order, and their live progress status. The priorities themselves are managed
// on the Priorities page; this only records the publication decision. Order is
// implied by array position and persisted as sortOrder on save.
export default function PrioritiesPublicationEditor({
  rows,
  onChange,
  disabled,
}: {
  rows: PriorityRow[]
  onChange: (next: PriorityRow[]) => void
  disabled?: boolean
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        You don&apos;t have any priorities yet. Add them on the Priorities page
        and they&apos;ll show up here to publish.
      </p>
    )
  }

  const patch = (index: number, next: Partial<PriorityRow>): void => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)))
  }

  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div
          key={row.issueId}
          className="flex items-start gap-3 rounded-lg border border-gray-200 p-3"
        >
          <div className="flex flex-col">
            <Button
              type="button"
              variant="ghost"
              size="small"
              aria-label="Move up"
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="small"
              aria-label="Move down"
              disabled={disabled || index === rows.length - 1}
              onClick={() => move(index, 1)}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-gray-900">
              {row.title || 'Untitled priority'}
            </p>
            {row.description && (
              <p className="line-clamp-2 text-sm text-gray-500">
                {row.description}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <Switch
                  checked={row.visible}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    patch(index, { visible: checked })
                  }
                />
                Show publicly
              </label>
              <select
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
                value={row.status ?? ''}
                disabled={disabled || !row.visible}
                onChange={(e) =>
                  patch(index, {
                    status:
                      e.target.value === ''
                        ? null
                        : (e.target.value as PersonProfileIssueStatus),
                  })
                }
              >
                <option value="">No status</option>
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
