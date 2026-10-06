'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { z } from 'zod'
import Link from 'next/link'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import {
  composeOutreachHref,
  parseTrackerOrigin,
} from 'app/dashboard/outreach/util/composeOutreachHref.util'
import {
  AlertDialog,
  CheckIcon,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  ExternalLinkIcon,
  MessageSquareIcon,
  Overline,
  cn,
} from '@styleguide'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useCampaignManagerChat } from 'app/dashboard/campaign-manager/CampaignManagerChatProvider'
import { MoreMenu } from 'app/shared/utils/MoreMenu'
import { PHASE_META, buildTrackerStrategy } from './buildTrackerStrategy'
import { formatTaskDate } from './CampaignStrategyTaskRow'
import { useCompleteTrackerTask } from './useCompleteTrackerTask'
import { isVoterContactFlowType, useTrackerTasks } from './useTrackerTasks'
import { selectTopDynamicTasks } from 'app/dashboard/campaign-manager/selectTopDynamicTasks'
import { BALLOT_CARD_COPY } from 'app/dashboard/campaign-manager/GetOnBallotCard'
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'
import type {
  CampaignStrategyData,
  CampaignStrategyPhase,
  CampaignStrategyTask,
} from './campaignStrategy.types'

// Every phase can flag its own next task, so the phase happening now wins.
// Active lists tasks by week, and only the current week carries the flag.
const findNextTask = (
  strategy: CampaignStrategyData,
): CampaignStrategyTask | undefined => {
  const visibleTasks = (phase: CampaignStrategyPhase) =>
    phase.weeks
      ? (phase.weeks.find((week) => week.isCurrent)?.tasks ?? [])
      : phase.groups.flatMap((group) => group.tasks)
  return [...strategy.phases]
    .sort(
      (a, b) => Number(b.status === 'active') - Number(a.status === 'active'),
    )
    .flatMap(visibleTasks)
    .find((task) => task.isNext && !task.completed)
}

// The fields the card shows. The next task comes from the tracker's render
// shape and the stacked priorities from raw rows, so both narrow to this.
type DeckTask = Pick<CampaignStrategyTask, 'id' | 'title' | 'description'> & {
  date: string | null
  // Set for the Campaign Manager's own prompts (ballot, story, meet), which
  // join the stack as cards with their one action instead of a task's.
  prompt?: { ctaLabel: string; onCta: () => void }
}

// Sent as the candidate's first message, so the manager answers about this
// task instead of opening on its greeting.
export const discussTaskMessage = (task: DeckTask): string => {
  const due = formatTaskDate(task.date)
  return [
    `Help me with this task from my campaign plan: "${task.title}".`,
    task.description,
    due ? `It is due ${due}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// The card's main CTA: the place in the product where the task actually gets
// done, named for that action. A task's own link wins; otherwise its outreach
// channel opens that flow in the hub (with the due date and task attached,
// like the rail's "Start outreach"). Static rows carry no channel, so the call
// list is matched on its title. A task with nowhere to go returns null and
// "Mark as done" leads instead.
export const taskAction = (
  row: CampaignTrackerTask | undefined,
  surface: 'plan' | 'manager',
): { label: string; href: string; external: boolean } | null => {
  if (!row) return null
  const cta = row.cta?.trim()
  const link = row.link?.trim()
  if (link) {
    return { label: cta || 'Open', href: link, external: !link.startsWith('/') }
  }
  const source = surface === 'manager' ? 'campaign_manager' : 'campaign_tracker'
  const tracker = parseTrackerOrigin(row.id, row.phase)
  const hub = (compose: 'phoneBanking' | 'social'): string => {
    const params = new URLSearchParams({ compose, source })
    if (row.date) params.set('due', row.date.slice(0, 10))
    if (tracker) {
      params.set('trackerTaskId', tracker.trackerTaskId)
      params.set('phase', tracker.phase)
    }
    return `/dashboard/outreach?${params.toString()}`
  }
  if (row.flowType === 'text' || row.flowType === 'robocall') {
    return {
      label: row.flowType === 'text' ? 'Send a text' : 'Set up a robocall',
      href: composeOutreachHref(row.flowType, source, row.date, tracker),
      external: false,
    }
  }
  if (row.flowType === 'phoneBanking' || /call list/i.test(row.title)) {
    return {
      label: 'Create your call list',
      href: hub('phoneBanking'),
      external: false,
    }
  }
  if (row.flowType === 'doorKnocking') {
    return {
      label: 'Plan your door knocking',
      href: '/dashboard/door-knocking',
      external: false,
    }
  }
  if (row.flowType === 'socialMedia') {
    return {
      label: 'Create a social post',
      href: hub('social'),
      external: false,
    }
  }
  return null
}

// Skipped task ids, in the order skipped, shared by both surfaces so the plan
// and the manager always show the same front card. Kept in the browser: a skip
// reorders this candidate's stack, it does not reschedule the task.
const SKIPPED_KEY = 'next-task-skipped'
const skipListeners = new Set<() => void>()
let skippedRaw: string | null = null
let skippedCache: string[] = []

const readSkipped = (): string[] => {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(SKIPPED_KEY)
  } catch {
    // Storage disabled: keep whatever writeSkipped held in memory.
    return skippedCache
  }
  if (raw === skippedRaw) return skippedCache
  skippedRaw = raw
  try {
    const value: unknown = raw ? JSON.parse(raw) : []
    const parsed = z.array(z.string()).safeParse(value)
    skippedCache = parsed.success ? parsed.data : []
  } catch {
    skippedCache = []
  }
  return skippedCache
}

const writeSkipped = (ids: string[]): void => {
  try {
    window.localStorage.setItem(SKIPPED_KEY, JSON.stringify(ids))
  } catch {
    // Storage disabled: hold the skips in memory for this page load.
    skippedRaw = JSON.stringify(ids)
    skippedCache = ids
  }
  skipListeners.forEach((listener) => listener())
}

// Skip a task from outside the card (the tracker's "Do this next" row), so
// both surfaces share one skip list.
export const skipNextTask = (id: string): void =>
  writeSkipped([...readSkipped().filter((skipped) => skipped !== id), id])

const subscribeSkipped = (listener: () => void): (() => void) => {
  skipListeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    skipListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

const NO_SKIPS: string[] = []

// The front of the candidate's task stack as a card, shared by the Campaign
// Plan and the Campaign Manager. Reads the same tracker-tasks query the plan's
// rail uses, so a task completed on either surface leaves both.
const NextTaskCard = ({
  heading,
  subheading,
  surface,
  tone = 'default',
  className,
}: {
  // Omitted when the host frames the card with its own heading.
  heading?: string
  subheading?: string
  // Both surfaces hold the same stack (the next task, then this week's top
  // priorities) and the same skips, so they always show the same front card.
  // Only the manager draws the cards behind it; the plan has the full list
  // below.
  surface: 'plan' | 'manager'
  // 'inverse' for a host that sets the section on a dark band: the heading
  // switches to light text; the card stays white.
  tone?: 'default' | 'inverse'
  className?: string
}): React.JSX.Element | null => {
  const [campaign] = useCampaign()
  const { tasks } = useTrackerTasks()
  const chat = useCampaignManagerChat()
  const story = useCampaignStoryComplete(true)
  const { onToggleComplete, countModal } = useCompleteTrackerTask(tasks)
  const [confirmTaskId, setConfirmTaskId] = useState<string | null>(null)
  const skippedIds = useSyncExternalStore(
    subscribeSkipped,
    readSkipped,
    () => NO_SKIPS,
  )

  const metrics = campaign?.raceTargetMetrics
  const electionDateIso =
    metrics?.relevantElectionDate ??
    metrics?.generalElectionDate ??
    campaign?.details?.electionDate ??
    campaign?.electionDate ??
    null

  const nextTask = useMemo(() => {
    if (tasks.length === 0) return undefined
    const electionDate = electionDateIso
      ? new Date(electionDateIso.replace(/-/g, '/'))
      : null
    return findNextTask(buildTrackerStrategy(tasks, { electionDate }))
  }, [tasks, electionDateIso])

  // Every "do this now" card lives in this one stack, in the order the
  // candidate needs them: get on the ballot, tell the story (which is what
  // creates tracker tasks at all), the tasks themselves, then meeting the
  // manager. Prompts need the chat dock, so they drop out without it.
  const ballotCopy =
    campaign?.ballotStatus === 'qualified-not-filed' ||
    campaign?.ballotStatus === 'considering'
      ? BALLOT_CARD_COPY[campaign.ballotStatus]
      : null
  const storyPending = !story.isLoading && !story.isError && !story.isComplete
  const leadPrompts: DeckTask[] = chat
    ? [
        ...(ballotCopy
          ? [
              {
                id: 'prompt-ballot',
                title: ballotCopy.title,
                description: ballotCopy.description,
                date: null,
                prompt: {
                  ctaLabel: ballotCopy.ctaLabel,
                  onCta: chat.startBallotAccess,
                },
              },
            ]
          : []),
        ...(storyPending
          ? [
              {
                id: 'prompt-story',
                title: 'Tell us your campaign story',
                description:
                  'Share your why, your background, and the issues you care about to sharpen your plan.',
                date: null,
                prompt: {
                  ctaLabel: 'Personalize your campaign',
                  onCta: chat.startStory,
                },
              },
            ]
          : []),
      ]
    : []
  const trailPrompts: DeckTask[] =
    chat && !chat.meetDismissed
      ? [
          {
            id: 'prompt-meet',
            title: 'Meet your virtual Campaign Manager',
            description:
              'Introducing your Campaign Manager. Get a quick tour for how it can help.',
            date: null,
            prompt: {
              ctaLabel: 'Meet your Campaign Manager',
              onCta: chat.openManager,
            },
          },
        ]
      : []
  const deck: DeckTask[] = [
    ...leadPrompts,
    ...(nextTask ? [nextTask] : []),
    ...selectTopDynamicTasks(tasks).filter((task) => task.id !== nextTask?.id),
    ...trailPrompts,
  ]
  // Skipping sends a card to the back of the stack, in the order skipped. Only
  // for this visit: it reorders the stack, it does not reschedule the task.
  const skipRank = (id: string) => skippedIds.indexOf(id)
  deck.sort((a, b) => skipRank(a.id) - skipRank(b.id))
  const frontTask = deck[0]
  const layersBehind = surface === 'manager' ? Math.min(deck.length - 1, 2) : 0
  // The plan pins this card above the tracker, so there it is a compact strip:
  // one-line meta, a clamped description, small buttons in one row.
  const compact = surface === 'plan'
  const buttonSize = compact ? 'small' : 'medium'

  if (!frontTask) return countModal

  const frontPhase = tasks.find((row) => row.id === frontTask.id)?.phase
  const phaseTitle = PHASE_META.find((phase) => phase.key === frontPhase)?.title
  const dueDate = formatTaskDate(frontTask.date)
  const action = frontTask.prompt
    ? null
    : taskAction(
        tasks.find((row) => row.id === frontTask.id),
        surface,
      )

  // A task done inside the product (its action opens one of our own screens)
  // should close itself when that work happens, so it offers no manual "Mark
  // as done". Only the story task does so today; outreach still needs the
  // backend to close the task it was launched from. Offline work and external
  // links keep the button, since we can't see them.
  const completesItself = Boolean(action && !action.external)
  const markDone = () => {
    const row = tasks.find((task) => task.id === frontTask.id)
    // The count modal already stands in front of these.
    if (isVoterContactFlowType(row?.flowType ?? null)) {
      onToggleComplete(frontTask.id, true)
      return
    }
    setConfirmTaskId(frontTask.id)
  }
  const menuItems = [
    ...(deck.length > 1
      ? [
          {
            label: 'Skip',
            onClick: () =>
              writeSkipped([
                ...skippedIds.filter((id) => id !== frontTask.id),
                frontTask.id,
              ]),
          },
        ]
      : []),
  ]

  return (
    <section
      className={cn(
        'flex w-full flex-col',
        compact ? 'gap-3' : surface === 'manager' ? 'gap-8' : 'gap-4',
        className,
      )}
    >
      {heading && (
        <div className="flex items-start justify-between gap-4">
          <div
            className={cn(
              'flex flex-col gap-1',
              surface === 'manager' && 'w-full items-center text-center',
            )}
          >
            <h2
              className={cn(
                surface === 'manager'
                  ? 'text-2xl font-semibold'
                  : 'text-lg font-medium',
                tone === 'inverse'
                  ? 'text-primary-foreground'
                  : 'text-foreground',
              )}
            >
              {heading}
            </h2>
            {subheading && (
              <p
                className={cn(
                  'text-base',
                  tone === 'inverse'
                    ? 'text-primary-foreground/80'
                    : 'text-muted-foreground',
                )}
              >
                {subheading}
              </p>
            )}
          </div>
        </div>
      )}
      <div
        className={cn(
          'relative w-full',
          layersBehind === 2 && 'pb-4',
          layersBehind === 1 && 'pb-2',
        )}
      >
        {layersBehind === 2 && (
          <Card
            aria-hidden
            className="absolute inset-x-6 top-4 bottom-0 rounded-2xl border-components-input-border py-0"
          />
        )}
        {layersBehind >= 1 && (
          <Card
            aria-hidden
            className={cn(
              'absolute inset-x-3 top-2 rounded-2xl border-components-input-border py-0',
              layersBehind === 2 ? 'bottom-2' : 'bottom-0',
            )}
          />
        )}
        <Card className="relative min-h-20 gap-0 overflow-hidden rounded-2xl border-components-input-border py-0">
          <div
            className={cn(
              'flex flex-col gap-1',
              compact ? 'px-4 py-3' : 'px-6 py-5',
            )}
          >
            <div className="flex min-h-6 items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {frontTask.prompt ? (
                  <Overline>Campaign Manager</Overline>
                ) : (
                  <Overline>{phaseTitle}</Overline>
                )}
                {compact && dueDate && (
                  <span className="text-xs text-muted-foreground">
                    Due {dueDate}
                  </span>
                )}
              </div>
              {/* Skip is a quiet escape hatch, so it sits behind the menu
                      rather than beside the actions. */}
              {menuItems.length > 0 && <MoreMenu menuItems={menuItems} />}
            </div>
            <h3
              className={cn(
                'font-opensans font-medium text-card-foreground',
                compact ? 'text-base' : 'text-lg',
              )}
            >
              {frontTask.title}
            </h3>
            {!compact && dueDate && (
              <p className="text-muted-foreground text-sm">Due {dueDate}</p>
            )}
            <p
              className={cn(
                'text-muted-foreground text-sm',
                compact && 'line-clamp-2',
              )}
            >
              {frontTask.description}
            </p>
            <div
              className={cn(
                'flex gap-2',
                compact
                  ? 'flex-col pt-2 sm:flex-row sm:flex-wrap'
                  : 'flex-col pt-3 sm:flex-row sm:flex-wrap',
              )}
            >
              {frontTask.prompt ? (
                <Button
                  type="button"
                  size={buttonSize}
                  className="w-full sm:w-auto"
                  onClick={frontTask.prompt.onCta}
                >
                  {frontTask.prompt.ctaLabel}
                </Button>
              ) : (
                <>
                  {action && (
                    <Button
                      asChild
                      size={buttonSize}
                      className="w-full sm:w-auto"
                    >
                      {action.external ? (
                        <a href={action.href} target="_blank" rel="noreferrer">
                          {action.label}
                          <ExternalLinkIcon className="size-4" aria-hidden />
                        </a>
                      ) : (
                        <Link href={action.href}>{action.label}</Link>
                      )}
                    </Button>
                  )}
                  {!completesItself && (
                    <Button
                      type="button"
                      variant={action ? 'outline' : 'default'}
                      size={buttonSize}
                      className="w-full sm:w-auto"
                      onClick={markDone}
                    >
                      <CheckIcon className="size-4" aria-hidden />
                      Mark as done
                    </Button>
                  )}
                  {chat && (
                    <Button
                      type="button"
                      variant="ghost"
                      size={buttonSize}
                      className={cn(
                        'text-primary hover:bg-primary/5',
                        'w-full sm:w-auto',
                      )}
                      onClick={() =>
                        chat.discussTask(discussTaskMessage(frontTask))
                      }
                    >
                      <MessageSquareIcon className="size-4" aria-hidden />
                      Discuss in chat
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>
      </div>
      {/* Completing pulls the card away and brings the next one forward, so a
          stray press would lose the task from view. Brand-default action, not
          destructive: the task can be reopened from the plan. */}
      <AlertDialog
        open={confirmTaskId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTaskId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this task done?</AlertDialogTitle>
            <AlertDialogDescription>{frontTask.title}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmTaskId) onToggleComplete(confirmTaskId, true)
                setConfirmTaskId(null)
              }}
            >
              Mark done
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {countModal}
    </section>
  )
}

export default NextTaskCard
