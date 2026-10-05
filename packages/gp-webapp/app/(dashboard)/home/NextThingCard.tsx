'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import {
  Button,
  Card,
  CircleCheckIcon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  MoreHorizontalIcon,
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
import { useCampaignManagerChat } from '../campaign-manager/CampaignManagerChatProvider'
import CountModal from '../components/tasks/CountModal'
import FilingInstructionsDetails from '../shared/FilingInstructionsDetails'
import { useNextThing } from './useNextThing'
import { askAboutStep, headlineFor, questionsFor } from './nextThingCopy'

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
  format(parseISO(iso.slice(0, 10)), 'MMM d')

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

// Why this task is first, when there is something true to say. A badge that
// read "High priority" would show on every visit (the card is always the top
// task) and so say nothing.
const reasonTagFor = (
  task: CampaignTrackerTask,
  doneCount: number,
): string | null => {
  if (isTimeBoundTask(task)) return `Deadline ${formatDay(task.date)}`
  if (doneCount === 0) return 'Start here'
  return null
}

// The headline is the section's heading in every state (loading, error,
// caught up), so Home always has one stable landmark.
const NextThingSection = ({
  headline,
  children,
}: {
  headline: string
  children: React.ReactNode
}): React.JSX.Element => (
  <section className="flex flex-col gap-5" aria-labelledby="next-thing-heading">
    <h2
      id="next-thing-heading"
      className="text-balance text-2xl font-semibold text-foreground lg:text-3xl"
    >
      {headline}
    </h2>
    {children}
  </section>
)

/**
 * The one thing a candidate should do next, chosen by the same
 * selectNextTrackerTask the campaign plan uses, under a friendly headline about
 * it. One filled action, a quiet "Mark done", rare choices (Later, Not for me)
 * in the "…" menu, and right under the card two small questions about the
 * task that open chat. It stays
 * until they do it, mark it done, skip it, or its date passes on a task that
 * only exists on that date.
 */
export default function NextThingCard(): React.JSX.Element {
  const { tasks, isPending, isError, next, progress, needsFiling, eventProps } =
    useNextThing()
  const chat = useCampaignManagerChat()
  const toggleComplete = useToggleTrackerTaskComplete()
  const skipTask = useSkipTrackerTask()
  const [countTask, setCountTask] = useState<CampaignTrackerTask | null>(null)
  const [filingOpen, setFilingOpen] = useState(false)

  const headline = headlineFor(next, needsFiling)

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

  const onStarted = (via: 'cta' | 'chat'): void => {
    if (eventProps) {
      trackEvent(EVENTS.Dashboard.CampaignPlan.NextThingStarted, {
        ...eventProps,
        via,
      })
    }
  }

  if (isPending) {
    return (
      <NextThingSection headline={headline}>
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
      <NextThingSection headline={headline}>
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
      <NextThingSection headline={headline}>
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
  const reasonTag = reasonTagFor(next, progress.done)

  return (
    <NextThingSection headline={headline}>
      <Card className="gap-4 rounded-2xl border border-grayscale-300 p-4 shadow-sm lg:p-6">
        <div className="flex flex-col gap-2">
          {reasonTag && (
            <span className="self-start rounded-full bg-primary-light px-2.5 py-0.5 text-xs font-semibold text-primary-dark">
              {reasonTag}
            </span>
          )}
          <h3 className="text-xl font-semibold text-card-foreground">
            {next.title}
          </h3>
          {next.description && (
            <p className="text-sm text-muted-foreground">{next.description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {action.kind === 'filing' && (
            <Button
              type="button"
              onClick={() => {
                onStarted('cta')
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
                  onClick={() => onStarted('cta')}
                >
                  {action.label}
                </a>
              ) : (
                <Link href={action.href} onClick={() => onStarted('cta')}>
                  {action.label}
                </Link>
              )}
            </Button>
          )}
          <Button
            type="button"
            variant={action.kind === 'none' ? 'default' : 'ghost'}
            disabled={busy}
            onClick={() => onMarkDone(next)}
          >
            <CircleCheckIcon className="size-4" aria-hidden />
            Mark done
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                type="button"
                variant="ghost"
                className="ml-auto"
                disabled={busy}
                aria-label="More options"
              >
                <MoreHorizontalIcon className="size-5" aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
              <DropdownMenuSeparator />
              {/* The sidebar's Campaign Plan covers desktop; this keeps the
                  plan one tap away on a phone, where the sidebar is a drawer. */}
              <DropdownMenuItem asChild>
                <Link href="/campaign-plan">See it in your plan</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>

      {chat && (
        <div className="flex flex-wrap gap-2">
          {questionsFor(next, needsFiling).map((question) => (
            <Button
              key={question}
              type="button"
              variant="outline"
              size="small"
              className="rounded-full"
              onClick={() => {
                onStarted('chat')
                chat.sendFromComposer(askAboutStep(next.title, question))
              }}
            >
              {question}
            </Button>
          ))}
        </div>
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
