'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import type { Priority } from '@goodparty_org/contracts'
import { createOrdinance } from '../data/ordinances-api'

export default function MyPriorityIssuesSection({
  priorities,
}: {
  priorities: Priority[]
}): React.JSX.Element {
  const router = useRouter()
  const [seedingId, setSeedingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Seed a new ordinance from the priority's goal and drop into the flow. One
  // at a time; disable the whole grid while a seed is in flight.
  const workOnThis = async (priority: Priority): Promise<void> => {
    if (seedingId) return
    setSeedingId(priority.id)
    setError(null)
    try {
      const ordinance = await createOrdinance({
        seedType: 'new',
        goalText: priority.title,
      })
      router.push(`/dashboard/ordinances/solve/${ordinance.slug}/clarify`)
    } catch {
      setError(
        'Could not start an ordinance from this issue. Please try again.',
      )
      setSeedingId(null)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          My priority issues
        </h2>
        <p className="text-sm text-muted-foreground">
          Issues you&apos;ve marked as priorities to work on.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {priorities.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No priority issues yet. Mark issues as priorities in Community Issues
          to turn them into ordinances here.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {priorities.map((priority) => (
            <div
              key={priority.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {priority.title}
                </h3>
                <p className="line-clamp-3 text-sm text-muted-foreground">
                  {priority.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void workOnThis(priority)}
                disabled={seedingId !== null}
                className="mt-auto inline-flex items-center gap-1 self-end text-sm font-medium text-components-input-active hover:underline disabled:opacity-50"
              >
                {seedingId === priority.id ? 'Starting...' : 'Work on this'}
                <ChevronRightIcon className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
