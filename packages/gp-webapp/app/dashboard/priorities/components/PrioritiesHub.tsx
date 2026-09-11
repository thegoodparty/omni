'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Badge, Button, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import type { Priority, PrioritySource } from '@goodparty_org/contracts'
import type { CommunityIssueCard } from 'gpApi/api-endpoints'
import AddPriorityForm from './AddPriorityForm'
import { prioritizeCommunityIssue } from '../data/priorities-api'

// The top N an official can actually hold in their head at once. Below the line
// a priority still lives here, it just does not read as a focus.
const TOP_N = 3

// Where a priority came from, in the user's terms. The filter chips and the row
// badge read from the same place, so a lane cannot be named two ways.
const SOURCE_META: Record<
  PrioritySource,
  { label: string; pillClass: string; activeClass: string }
> = {
  win_import: {
    label: 'From your campaign',
    pillClass: 'border-info/50 bg-info/10 text-info-dark',
    activeClass: 'border-info bg-info/20 text-info-dark',
  },
  community_issue: {
    label: 'From your community',
    pillClass: 'border-success/50 bg-success/10 text-success-dark',
    activeClass: 'border-success bg-success/20 text-success-dark',
  },
  user_stated: {
    label: 'Yours',
    pillClass: 'border-border bg-muted text-muted-foreground',
    activeClass: 'border-foreground/40 bg-muted text-foreground',
  },
}

const SOURCE_ORDER: PrioritySource[] = [
  'user_stated',
  'community_issue',
  'win_import',
]

export default function PrioritiesHub({
  priorities,
  seedIssues,
}: {
  priorities: Priority[]
  seedIssues: CommunityIssueCard[]
}): React.JSX.Element {
  const [items, setItems] = useState<Priority[]>(priorities)
  const [filter, setFilter] = useState<PrioritySource | null>(null)
  const [adding, setAdding] = useState(false)
  const [pendingIssueId, setPendingIssueId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const counts = useMemo(() => {
    const tally: Record<string, number> = {}
    for (const item of items) {
      tally[item.source] = (tally[item.source] ?? 0) + 1
    }
    return tally
  }, [items])

  const visible = filter ? items.filter((p) => p.source === filter) : items

  const unseeded = useMemo(
    () => seedIssues.filter((issue) => !issue.prioritized).slice(0, 4),
    [seedIssues],
  )

  const addFromIssue = async (issue: CommunityIssueCard): Promise<void> => {
    if (pendingIssueId) return
    setPendingIssueId(issue.id)
    setError(null)
    try {
      const created = await prioritizeCommunityIssue(issue.id)
      setItems((prev) => [...prev, created])
    } catch {
      setError('Could not add that issue. Please try again.')
    } finally {
      setPendingIssueId(null)
    }
  }

  return (
    <>
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              My priorities
            </h2>
            <p className="text-sm text-muted-foreground">
              What you&apos;re working on this term, most important first.
            </p>
          </div>
          <Button
            className="rounded-full text-sm"
            onClick={() => setAdding(true)}
            disabled={adding}
          >
            Add a priority
          </Button>
        </div>

        {adding ? (
          <AddPriorityForm
            onCreated={(created) => {
              setItems((prev) => [...prev, created])
              setAdding(false)
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}

        <div className="flex flex-wrap gap-2">
          {SOURCE_ORDER.map((source) => {
            const meta = SOURCE_META[source]
            const active = filter === source
            return (
              <button
                key={source}
                type="button"
                onClick={() => setFilter(active ? null : source)}
                aria-pressed={active}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors',
                  active ? meta.activeClass : meta.pillClass,
                )}
              >
                {meta.label} ({counts[source] ?? 0})
              </button>
            )
          })}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {visible.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {filter
              ? 'Nothing in this lane yet.'
              : 'Nothing here yet. Add what you want to get done, or pull one in from the issues your community is raising.'}
          </div>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {visible.map((priority, index) => {
              const meta = SOURCE_META[priority.source]
              return (
                <Link
                  key={priority.id}
                  href={`/dashboard/priorities/${priority.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      !filter && index < TOP_N
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {priority.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {priority.targetDate
                        ? `Target ${format(new Date(priority.targetDate), 'MMM d, yyyy')}`
                        : 'No target date'}
                    </p>
                  </div>
                  <Badge
                    className={cn('shrink-0 rounded-full', meta.pillClass)}
                  >
                    {meta.label}
                  </Badge>
                  <ChevronRightIcon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {unseeded.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              What your community is raising
            </h2>
            <p className="text-sm text-muted-foreground">
              Issues from your district you haven&apos;t picked up yet.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {unseeded.map((issue) => (
              <div
                key={issue.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-medium text-foreground">
                    {issue.title}
                  </h3>
                  <p className="line-clamp-3 text-sm text-muted-foreground">
                    {issue.summary}
                  </p>
                </div>
                <Button
                  size="small"
                  variant="outline"
                  className="mt-auto self-start rounded-full"
                  onClick={() => void addFromIssue(issue)}
                  disabled={pendingIssueId !== null}
                  loading={pendingIssueId === issue.id}
                >
                  Make this a priority
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}
