'use client'

import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { Badge, Button, CalendarIcon, cn } from '@styleguide'
import { useTrackerTasks } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import { selectTopDynamicTasks } from './selectTopDynamicTasks'

const TRACKER_HREF = '/dashboard/campaign-plan'

// Tracker dates arrive as UTC-midnight ISO; slice to the date portion so the
// local render does not land on the previous day in US timezones.
const formatDue = (iso: string): string =>
  format(parseISO(iso.slice(0, 10)), 'EEE, MMM d')

interface Props {
  onMeetManager: () => void
}

export default function CampaignManagerTasks({
  onMeetManager,
}: Props): React.JSX.Element {
  const { tasks, isPending, isError, isGeneratingDynamic } = useTrackerTasks()
  const top = selectTopDynamicTasks(tasks)

  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Your campaign manager</h1>
          <p className="text-sm text-muted-foreground">
            The two or three things that matter most this week, and a manager to
            help you decide what to do next.
          </p>
        </div>
        <Button className="self-start" onClick={onMeetManager}>
          Meet your campaign manager
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Your top priorities this week
        </h2>
        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading your tasks.</p>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            We could not load your tasks. Refresh to try again.
          </p>
        ) : isGeneratingDynamic ? (
          <p className="text-sm text-muted-foreground">
            We are preparing your personalized tasks. Check back in a few
            minutes.
          </p>
        ) : top.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tasks to show yet. Your manager will surface priorities as your
            plan develops.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {top.map((task) => (
              <li key={task.id}>
                <Link
                  href={TRACKER_HREF}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-lg border',
                    'border-border bg-card p-4 transition-colors hover:bg-muted',
                  )}
                >
                  <span className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{task.title}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarIcon className="size-3.5" aria-hidden />
                      {formatDue(task.date)}
                    </span>
                  </span>
                  {task.phase && (
                    <Badge className="shrink-0 capitalize">{task.phase}</Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
