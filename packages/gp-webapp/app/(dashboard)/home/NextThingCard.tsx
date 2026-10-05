'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import {
  Button,
  Card,
  cn,
  ChevronDownIcon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
} from '@styleguide'
import {
  isTimeBoundTask,
  TRACKER_TASK_SNOOZE_DAYS,
  type TrackerTaskSkipReason,
} from '@goodparty_org/contracts'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  isVoterContactFlowType,
  useSkipTrackerTask,
  useToggleTrackerTaskComplete,
} from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import {
  composeOutreachHref,
  parseTrackerOrigin,
  type ComposeFlowType,
} from 'app/(dashboard)/outreach/util/composeOutreachHref.util'
import CountModal from '../components/tasks/CountModal'
import FilingInstructionsDetails from '../shared/FilingInstructionsDetails'
import { useNextThing } from './useNextThing'

// A task's own action link, if it has a non-empty one. Trimmed so an empty or
// whitespace string (which the agent can emit) counts as "no link".
const taskLink = (task: { link: string | null }): string | null =>
  task.link?.trim() ? task.link : null

// Text/robocall tasks with no link of their own start the outreach hub's
// compose flow with the due date bound, the same as the plan's rows.
const composeFlowType = (task: CampaignTrackerTask): ComposeFlowType | null => {
  if (taskLink(task)) return null
  return task.flowType === 'text' || task.flowType === 'robocall'
    ? task.flowType
    : null
}

const isExternalHref = (href: string): boolean =>
  /^(https?:)?\/\//.test(href) ||
  href.startsWith('mailto:') ||
  href.startsWith('tel:')

// Tracker dates arrive as UTC-midnight ISO; slice to the date portion so the
// local render does not land on the previous day in US timezones.
const formatDay = (iso: string): string =>
  format(parseISO(iso.slice(0, 10)), 'EEE, MMM d')

const SKIP_OPTIONS: {
  reason: TrackerTaskSkipReason
  label: string
  caption: string
}[] = [
  {
    reason: 'later',
    label: 'Later',
    caption: `Show it again in ${TRACKER_TASK_SNOOZE_DAYS} days`,
  },
  {
    reason: 'notForMe',
    label: 'Not for me',
    caption: "Don't suggest it again",
  },
]

type PrimaryAction =
  | { kind: 'filing'; label: string }
  | { kind: 'link'; label: string; href: string }
  | { kind: 'none' }

const primaryActionFor = (
  task: CampaignTrackerTask,
  needsFiling: boolean,
): PrimaryAction => {
  if (needsFiling) return { kind: 'filing', label: 'See how to file' }
  const own = taskLink(task)
  if (own) {
    return { kind: 'link', label: task.cta?.trim() || 'Open', href: own }
  }
  const composeType = composeFlowType(task)
  if (composeType) {
    return {
      kind: 'link',
      label: 'Start outreach',
      href: composeOutreachHref(
        composeType,
        'campaign_manager',
        task.date,
        parseTrackerOrigin(task.id, task.phase),
      ),
    }
  }
  return { kind: 'none' }
}

/**
 * The one thing a candidate should do next, chosen by the same
 * selectNextTrackerTask the campaign plan uses. It stays until they do it,
 * mark it done, skip it, or its date passes on a task that only exists on that
 * date. The main action depends on the task; marking done and skipping work
 * the same for every task. Home's chat box sits directly under it, about the
 * same task (see HomeComposer).
 */
// The section heading renders in every state (loading, error, caught up), so
// Home always has one stable landmark for the next thing.
const NextThingSection = ({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element => (
  <section className="flex flex-col gap-3" aria-labelledby="next-thing-heading">
    <h2
      id="next-thing-heading"
      className="text-sm font-semibold text-muted-foreground"
    >
      Do this next
    </h2>
    {children}
  </section>
)

export default function NextThingCard(): React.JSX.Element {
  const {
    tasks,
    isPending,
    isError,
    next,
    queue,
    remaining,
    progress,
    needsFiling,
    eventProps,
  } = useNextThing()
  const toggleComplete = useToggleTrackerTaskComplete()
  const skipTask = useSkipTrackerTask()
  const [countTask, setCountTask] = useState<CampaignTrackerTask | null>(null)
  const [filingOpen, setFilingOpen] = useState(false)

  // Once per task shown, not per render: the tracker query polls.
  const nextId = next?.id ?? null
  useEffect(() => {
    if (!nextId || !eventProps) return
    trackEvent(EVENTS.Dashboard.CampaignPlan.NextThingViewed, eventProps)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextId])

  const complete = (task: CampaignTrackerTask, quantity?: number): void => {
    if (eventProps) {
      trackEvent(EVENTS.Dashboard.CampaignPlan.TaskCompleted, {
        trackerTaskId: task.id,
        medium: eventProps.medium,
        ...(task.phase ? { phase: task.phase } : {}),
      })
      trackEvent(EVENTS.Dashboard.CampaignPlan.NextThingCompleted, eventProps)
    }
    toggleComplete.mutate({
      id: task.id,
      completed: true,
      ...(quantity !== undefined && task.flowType
        ? { type: task.flowType, quantity }
        : {}),
    })
  }

  const onMarkDone = (task: CampaignTrackerTask): void => {
    // Outreach and event tasks ask how many voters were reached first, and the
    // events ride the count submit, so cancelling the count records nothing.
    if (isVoterContactFlowType(task.flowType)) {
      setCountTask(task)
      return
    }
    complete(task)
  }

  const onSkip = (task: CampaignTrackerTask, reason: TrackerTaskSkipReason) => {
    if (eventProps) {
      trackEvent(EVENTS.Dashboard.CampaignPlan.NextThingSkipped, {
        ...eventProps,
        reason,
      })
    }
    skipTask.mutate({ id: task.id, reason })
  }

  const onStarted = (): void => {
    if (eventProps) {
      trackEvent(EVENTS.Dashboard.CampaignPlan.NextThingStarted, {
        ...eventProps,
        via: 'cta',
      })
    }
  }

  if (isPending) {
    return (
      <NextThingSection>
        <Card className="rounded-2xl border border-grayscale-300 p-4 lg:p-6">
          <p className="text-sm text-muted-foreground">
            Loading your next step.
          </p>
        </Card>
      </NextThingSection>
    )
  }

  if (isError) {
    return (
      <NextThingSection>
        <Card className="rounded-2xl border border-grayscale-300 p-4 lg:p-6">
          <p className="text-sm text-muted-foreground">
            We could not load your next step. Refresh to try again.
          </p>
        </Card>
      </NextThingSection>
    )
  }

  if (!next) {
    return (
      <NextThingSection>
        {tasks.length === 0 ? (
          <Card className="rounded-2xl border border-grayscale-300 p-4 lg:p-6">
            <p className="text-sm text-muted-foreground">
              We are putting your plan together. Your first step will show up
              here.
            </p>
          </Card>
        ) : (
          <EmptyState
            title="You're all caught up"
            message="Check your campaign plan to see what's coming up."
            action={
              <Button asChild variant="outline">
                <Link href="/campaign-plan">Open campaign plan</Link>
              </Button>
            }
          />
        )}
      </NextThingSection>
    )
  }

  const action = primaryActionFor(next, needsFiling)
  const busy = toggleComplete.isPending || skipTask.isPending

  return (
    <NextThingSection>
      <div className="relative pb-5">
        <Card className="relative z-10 gap-3 rounded-2xl border border-grayscale-300 p-4 shadow-sm lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {progress && progress.total > 0 && (
              <span className="text-xs font-medium text-muted-foreground">
                Step {progress.step} of {progress.total} · {progress.phaseTitle}
              </span>
            )}
            {isTimeBoundTask(next) && (
              <span className="rounded-full bg-warning-light px-2.5 py-0.5 text-xs font-semibold text-warning-dark">
                {formatDay(next.date)}
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-card-foreground">
            {next.title}
          </h3>
          {next.description && (
            <p className="text-sm text-muted-foreground">{next.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            {action.kind === 'filing' && (
              <Button
                type="button"
                onClick={() => {
                  onStarted()
                  setFilingOpen(true)
                }}
              >
                {action.label}
              </Button>
            )}
            {action.kind === 'link' && (
              <Button asChild>
                {isExternalHref(action.href) ? (
                  <a
                    href={action.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => onStarted()}
                  >
                    {action.label}
                  </a>
                ) : (
                  <Link href={action.href} onClick={() => onStarted()}>
                    {action.label}
                  </Link>
                )}
              </Button>
            )}
            <Button
              type="button"
              variant={action.kind === 'none' ? 'default' : 'outline'}
              disabled={busy}
              onClick={() => onMarkDone(next)}
            >
              Mark as done
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" disabled={busy}>
                  Skip
                  <ChevronDownIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {SKIP_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.reason}
                    onSelect={() => onSkip(next, option.reason)}
                    className="flex flex-col items-start gap-0"
                  >
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {option.caption}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Card>
        {/* Edges of what's queued behind the next thing (the Wallet /
            notification-stack cue). Only their rims show, so they carry no
            text; the count and the full list are below. */}
        {queue.map((task, index) => (
          <div
            key={task.id}
            aria-hidden
            className={cn(
              'absolute inset-x-0 mx-auto h-10 rounded-2xl border border-grayscale-300 bg-card',
              index === 0
                ? 'bottom-2.5 z-[5] w-[94%]'
                : 'bottom-0 z-0 w-[88%] opacity-70',
            )}
          />
        ))}
      </div>
      {remaining > 0 && (
        <p className="text-sm text-muted-foreground">
          {remaining === 1 ? '1 more step' : `${remaining} more steps`} after
          this.{' '}
          <Link href="/campaign-plan" className="font-medium text-primary">
            See your full plan
          </Link>
        </p>
      )}

      <Dialog open={filingOpen} onOpenChange={setFilingOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>How do you get on the ballot?</DialogTitle>
            <DialogDescription>
              Here is what your filing office needs from you.
            </DialogDescription>
          </DialogHeader>
          <FilingInstructionsDetails />
        </DialogContent>
      </Dialog>

      {countTask && (
        <CountModal
          open
          onOpenChange={(open) => {
            if (!open) setCountTask(null)
          }}
          flowType={countTask.flowType ?? ''}
          onSubmit={(count: number) => {
            complete(countTask, count)
            setCountTask(null)
          }}
        />
      )}
    </NextThingSection>
  )
}
