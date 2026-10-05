'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import {
  Button,
  Card,
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
  MessageSquareIcon,
} from '@styleguide'
import {
  isBallotAccessTask,
  isTimeBoundTask,
  selectNextTrackerTask,
  TRACKER_TASK_SNOOZE_DAYS,
  type TrackerTaskSkipReason,
} from '@goodparty_org/contracts'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCampaign } from '@shared/hooks/useCampaign'
import {
  isVoterContactFlowType,
  useSkipTrackerTask,
  useToggleTrackerTaskComplete,
  useTrackerTasks,
} from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import { useCampaignManagerChat } from '../campaign-manager/CampaignManagerChatProvider'
import {
  composeOutreachHref,
  parseTrackerOrigin,
  type ComposeFlowType,
} from 'app/(dashboard)/outreach/util/composeOutreachHref.util'
import { outreachChannel } from 'app/(dashboard)/outreach/util/outreachAnalytics'
import CountModal from '../components/tasks/CountModal'
import FilingInstructionsDetails from '../shared/FilingInstructionsDetails'

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
 * date. The main action depends on the task; marking done, skipping and asking
 * in chat work the same for every task.
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
  const { tasks, isPending, isError } = useTrackerTasks()
  const [campaign] = useCampaign()
  const chat = useCampaignManagerChat()
  const toggleComplete = useToggleTrackerTaskComplete()
  const skipTask = useSkipTrackerTask()
  const [countTask, setCountTask] = useState<CampaignTrackerTask | null>(null)
  const [filingOpen, setFilingOpen] = useState(false)

  const onBallot = campaign?.ballotStatus === 'on-ballot'
  const metrics = campaign?.raceTargetMetrics
  const electionDateIso =
    metrics?.relevantElectionDate ??
    metrics?.generalElectionDate ??
    campaign?.details?.electionDate ??
    campaign?.electionDate ??
    null

  const next = useMemo(
    () =>
      selectNextTrackerTask(tasks, {
        onBallot,
        electionDate: electionDateIso
          ? new Date(electionDateIso.replace(/-/g, '/'))
          : null,
        now: new Date(),
      }),
    [tasks, onBallot, electionDateIso],
  )

  const needsFiling = Boolean(next && !onBallot && isBallotAccessTask(next))

  const eventProps = useMemo(() => {
    if (!next) return null
    return {
      trackerTaskId: next.id,
      medium: outreachChannel(next.flowType ?? ''),
      ...(next.phase ? { phase: next.phase } : {}),
      candidateStage: campaign?.ballotStatus ?? 'unanswered',
      ...(electionDateIso
        ? {
            daysToElection: differenceInCalendarDays(
              new Date(electionDateIso.replace(/-/g, '/')),
              new Date(),
            ),
          }
        : {}),
      isBallotAccess: needsFiling,
    }
  }, [next, campaign?.ballotStatus, electionDateIso, needsFiling])

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

  const onAskInChat = (task: CampaignTrackerTask): void => {
    if (!chat) return
    onStarted('chat')
    if (needsFiling) {
      chat.startBallotAccess()
      return
    }
    chat.askAboutTask(task)
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
      <Card className="gap-3 rounded-2xl border border-grayscale-300 bg-gradient-to-b from-primary/5 to-card p-4 shadow-sm lg:p-6">
        <h3 className="text-lg font-semibold text-card-foreground">
          {next.title}
        </h3>
        {isTimeBoundTask(next) && (
          <p className="text-sm text-muted-foreground">
            {formatDay(next.date)}
          </p>
        )}
        {next.description && (
          <p className="text-sm text-muted-foreground">{next.description}</p>
        )}

        <div className="flex flex-col gap-3 pt-2">
          {action.kind === 'filing' && (
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                onStarted('cta')
                setFilingOpen(true)
              }}
            >
              {action.label}
            </Button>
          )}
          {action.kind === 'link' && (
            <Button asChild className="w-full">
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

          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant={action.kind === 'none' ? 'default' : 'outline'}
              size="small"
              disabled={busy}
              onClick={() => onMarkDone(next)}
            >
              Mark as done
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  disabled={busy}
                >
                  Skip
                  <ChevronDownIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
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
            {chat && (
              <Button
                type="button"
                variant="ghost"
                size="small"
                onClick={() => onAskInChat(next)}
              >
                <MessageSquareIcon className="size-4" />
                Ask in chat
              </Button>
            )}
          </div>
        </div>
      </Card>

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
