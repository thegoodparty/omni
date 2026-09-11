'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, IconButton, Label, Switch, cn } from '@styleguide'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
} from '@styleguide/components/ui/icons'
import type { Priority, PrioritySource } from '@goodparty_org/contracts'
import type { CommunityIssueCard } from 'gpApi/api-endpoints'
import AddPriorityForm from './AddPriorityForm'
import { prioritizeCommunityIssue } from '../data/priorities-api'

// The top N an official can actually hold in their head at once. Anything
// below the line still lives here, it just does not read as a focus.
const TOP_N = 3

// Where a priority came from, in the user's terms. Nothing for one they typed
// in themselves, since the badge would only tell them what they just did.
const SOURCE_BADGES: Record<PrioritySource, string | null> = {
  win_import: 'From your campaign',
  community_issue: 'From your community',
  user_stated: null,
}

export default function PrioritiesHub({
  priorities,
  seedIssues,
}: {
  priorities: Priority[]
  seedIssues: CommunityIssueCard[]
}): React.JSX.Element {
  const router = useRouter()
  const [items, setItems] = useState<Priority[]>(priorities)
  // Rank and visibility have no columns on Priority yet, so both live here for
  // the session. A change the user makes will not be here when they come back.
  const [publicIds, setPublicIds] = useState<Set<string>>(new Set())
  const [pendingIssueId, setPendingIssueId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const unseeded = useMemo(
    () => seedIssues.filter((issue) => !issue.prioritized).slice(0, 4),
    [seedIssues],
  )

  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    if (!moved) return
    next.splice(target, 0, moved)
    setItems(next)
  }

  const toggleVisibility = (id: string): void => {
    setPublicIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
        <div>
          <h2 className="text-base font-semibold text-foreground">
            What are you working on?
          </h2>
          <p className="text-sm text-muted-foreground">
            Your top {TOP_N} sit at the front. Everything else waits its turn.
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {items.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Nothing here yet. Add what you want to get done, or pull one in from
            the issues your community is raising.
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {items.map((priority, index) => (
              <li
                key={priority.id}
                className={cn(
                  'flex gap-3 rounded-xl border bg-card p-4',
                  index < TOP_N ? 'border-primary/40' : 'border-border',
                )}
              >
                <div className="flex flex-col items-center gap-1 pt-0.5">
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                      index < TOP_N
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {index + 1}
                  </span>
                  <IconButton
                    variant="ghost"
                    size="small"
                    className="!size-6"
                    aria-label={`Move ${priority.title} up`}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                  >
                    <ChevronUpIcon className="size-4" aria-hidden />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    size="small"
                    className="!size-6"
                    aria-label={`Move ${priority.title} down`}
                    onClick={() => move(index, 1)}
                    disabled={index === items.length - 1}
                  >
                    <ChevronDownIcon className="size-4" aria-hidden />
                  </IconButton>
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-medium text-foreground">
                      {priority.title}
                    </h3>
                    {SOURCE_BADGES[priority.source] ? (
                      <Badge variant="secondary" className="shrink-0">
                        {SOURCE_BADGES[priority.source]}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {priority.description}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`visibility-${priority.id}`}
                        checked={publicIds.has(priority.id)}
                        onCheckedChange={() => toggleVisibility(priority.id)}
                      />
                      <Label
                        htmlFor={`visibility-${priority.id}`}
                        className="text-sm font-normal text-muted-foreground"
                      >
                        {publicIds.has(priority.id)
                          ? 'On your public page'
                          : 'Just for you'}
                      </Label>
                    </div>

                    <Button
                      size="small"
                      variant="ghost"
                      iconPosition="right"
                      onClick={() =>
                        router.push(`/dashboard/priorities/${priority.id}`)
                      }
                    >
                      Work on this
                      <ChevronRightIcon className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        <p className="text-xs text-muted-foreground">
          Order and visibility are not saved yet, so they reset when you leave.
        </p>

        <AddPriorityForm
          onCreated={(created) => setItems((prev) => [...prev, created])}
        />
      </section>

      {unseeded.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              What your community is raising
            </h2>
            <p className="text-sm text-muted-foreground">
              Issues from your district you have not picked up yet.
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
                  className="mt-auto self-start"
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
