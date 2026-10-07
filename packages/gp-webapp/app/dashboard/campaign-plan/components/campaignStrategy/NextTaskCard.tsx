'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { differenceInCalendarDays, startOfDay } from 'date-fns'
import Link from 'next/link'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import {
  composeOutreachHref,
  parseTrackerOrigin,
} from 'app/dashboard/outreach/util/composeOutreachHref.util'
import {
  CheckIcon,
  ChevronDownIcon,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  IconButton,
  XMarkIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Button,
  CalendarIcon,
  Card,
  ConfettiBurst,
  EmptyState,
  ExternalLinkIcon,
  MessagesSquareIcon,
  cn,
} from '@styleguide'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useCampaignManagerChat } from 'app/dashboard/campaign-manager/CampaignManagerChatProvider'
import {
  buildTrackerStrategy,
  followingWeekStart,
} from './buildTrackerStrategy'
import { formatTaskDate, snoozeLabel } from './CampaignStrategyTaskRow'
import { useCompleteTrackerTask } from './useCompleteTrackerTask'
import { useSetTrackerTaskAside, useTrackerTasks } from './useTrackerTasks'
import {
  canSetTaskAsideForGood,
  isTrackerTaskSetAside,
} from '@goodparty_org/contracts'
import { selectTopDynamicTasks } from 'app/dashboard/campaign-manager/selectTopDynamicTasks'
import { useTaskHeadline } from 'app/dashboard/campaign-manager/homeHeadlines'
import type {
  CampaignStrategyData,
  CampaignStrategyPhase,
  CampaignStrategyTask,
} from './campaignStrategy.types'

// Every phase can flag its own next task, so the phase happening now wins.
// Active lists tasks by week, and only one week carries the flag: this one, or
// next week after a head start.
const findNextTask = (
  strategy: CampaignStrategyData,
): CampaignStrategyTask | undefined => {
  const visibleTasks = (phase: CampaignStrategyPhase) =>
    phase.weeks
      ? phase.weeks.flatMap((week) => week.tasks)
      : phase.groups.flatMap((group) => group.tasks)
  return [...strategy.phases]
    .sort(
      (a, b) => Number(b.status === 'active') - Number(a.status === 'active'),
    )
    .flatMap(visibleTasks)
    .find((task) => task.isNext && !task.completed)
}

// What the plan has after the next task: the open tasks that follow it in its
// own week (or phase), in the plan's order. They stand behind it in the stack,
// so finishing one brings the plan's real next one forward.
const followingTasks = (
  strategy: CampaignStrategyData,
  nextTask: CampaignStrategyTask,
): CampaignStrategyTask[] => {
  const siblings = strategy.phases
    .flatMap((phase) => [
      ...(phase.weeks ?? []).map((week) => week.tasks),
      ...phase.groups.map((group) => group.tasks),
    ])
    .find((list) => list.some((task) => task.id === nextTask.id))
  if (!siblings) return []
  return siblings
    .slice(siblings.findIndex((task) => task.id === nextTask.id) + 1)
    .filter((task) => !task.completed && task.setAside === null)
}

// The card's due line. Plain and muted while the date is a while off; once it
// is close or past it turns warning and says so in words, so it never relies
// on color alone. Warning rather than destructive: red means an error here,
// and a late task is something to catch up on, not a failure.
export const taskDueLabel = (
  date: string | null,
  today: Date,
): { label: string; urgent: boolean } | null => {
  const formatted = formatTaskDate(date)
  if (!date || !formatted) return null
  const days = differenceInCalendarDays(
    new Date(date.slice(0, 10).replace(/-/g, '/')),
    startOfDay(today),
  )
  if (days < 0) {
    const late = -days
    return {
      label: `${late} ${late === 1 ? 'day' : 'days'} overdue`,
      urgent: true,
    }
  }
  if (days === 0) return { label: 'Due today', urgent: true }
  if (days === 1) return { label: 'Due tomorrow', urgent: true }
  return { label: `Due ${formatted}`, urgent: false }
}

// Mark as done: the confetti bursts, then the card lifts off the top of the
// stack while the one behind it rises into place, all on one axis. A skipped
// card drops down and out instead, so the two never read the same.
const CELEBRATE_MS = 500
const EXIT_MS = 300

// The fields the card shows. The next task comes from the tracker's render
// shape and the stacked priorities from raw rows, so both narrow to this.
type DeckTask = Pick<CampaignStrategyTask, 'id' | 'title' | 'description'> & {
  date: string | null
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

// The week a candidate who finished this one pulled forward, shared by both
// surfaces so the plan's list and Home's card agree on the next task. Only
// next week counts (see buildTrackerStrategy), so it expires on its own.
const HEAD_START_KEY = 'next-task-head-start'
const headStartListeners = new Set<() => void>()
let headStartMemory: string | null = null

const readHeadStart = (): string | null => {
  try {
    return window.localStorage.getItem(HEAD_START_KEY)
  } catch {
    return headStartMemory
  }
}

const writeHeadStart = (week: string): void => {
  headStartMemory = week
  try {
    window.localStorage.setItem(HEAD_START_KEY, week)
  } catch {
    // Storage disabled: headStartMemory holds it for this page load.
  }
  headStartListeners.forEach((listener) => listener())
}

const subscribeHeadStart = (listener: () => void): (() => void) => {
  headStartListeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    headStartListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

export const useHeadStartWeek = (): string | null =>
  useSyncExternalStore(subscribeHeadStart, readHeadStart, () => null)

// Whether the plan's next-step section is folded. A per-viewer convenience,
// so it lives in the browser and survives a reload.
const COLLAPSED_KEY = 'next-task-collapsed'
const collapseListeners = new Set<() => void>()
let collapsedMemory = false

const readCollapsed = (): boolean => {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return collapsedMemory
  }
}

const writeCollapsed = (value: boolean): void => {
  collapsedMemory = value
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // Storage disabled: collapsedMemory holds it for this page load.
  }
  collapseListeners.forEach((listener) => listener())
}

const subscribeCollapsed = (listener: () => void): (() => void) => {
  collapseListeners.add(listener)
  return () => {
    collapseListeners.delete(listener)
  }
}

// The front of the candidate's task stack as a card, shared by the Campaign
// Plan and the Campaign Manager. Reads the same tracker-tasks query the plan's
// rail uses, so a task completed on either surface leaves both.
const NextTaskCard = ({
  heading,
  firstLanding = false,
  surface,
  tone = 'default',
  className,
}: {
  // The plan names its section. Without one, the heading follows the card in
  // front: a line for its kind of task, switching when the card does.
  heading?: string
  // Home's first landing after onboarding greets the candidate instead.
  firstLanding?: boolean
  // Both surfaces hold the same stack (the next task, then this week's top
  // priorities) and the same skips, so they always show the same front card.
  // Only the manager draws the cards behind it; the plan has the full list
  // below.
  surface: 'plan' | 'manager'
  // 'inverse' for a host that sets the section on a dark band: the heading
  // and the collapse toggle switch to light text; the card stays white.
  tone?: 'default' | 'inverse'
  className?: string
}): React.JSX.Element | null => {
  const [campaign] = useCampaign()
  const { tasks } = useTrackerTasks()
  const chat = useCampaignManagerChat()
  // The task just marked done, held in front while it celebrates and leaves.
  const [leaving, setLeaving] = useState<{
    id: string
    stage: 'celebrate' | 'exit'
    // Done lifts up; skipped drops down.
    direction: 'up' | 'down'
  } | null>(null)
  // Whatever comes forward next rises into place, then settles.
  const [arriving, setArriving] = useState(false)
  const { onToggleComplete, countModal } = useCompleteTrackerTask(tasks, {
    onCompleted: (id) =>
      setLeaving({ id, stage: 'celebrate', direction: 'up' }),
  })
  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(
      () => {
        if (leaving.stage === 'celebrate') {
          setLeaving({ ...leaving, stage: 'exit' })
          return
        }
        setLeaving(null)
        setArriving(true)
      },
      leaving.stage === 'celebrate' ? CELEBRATE_MS : EXIT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [leaving])
  const setAside = useSetTrackerTaskAside()
  // The plan's next step leads the page but can be folded away. The manager's
  // card is the page itself, so it always stays open.
  const collapsible = surface === 'plan'
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => false,
  )
  const open = !collapsible || !collapsed

  const metrics = campaign?.raceTargetMetrics
  const electionDateIso =
    metrics?.relevantElectionDate ??
    metrics?.generalElectionDate ??
    campaign?.details?.electionDate ??
    campaign?.electionDate ??
    null

  const headStartWeek = useHeadStartWeek()
  const strategy = useMemo(() => {
    if (tasks.length === 0) return null
    const electionDate = electionDateIso
      ? new Date(electionDateIso.replace(/-/g, '/'))
      : null
    return buildTrackerStrategy(tasks, { electionDate, headStartWeek })
  }, [tasks, electionDateIso, headStartWeek])
  const nextTask = strategy ? findNextTask(strategy) : undefined

  // The stack always leads with the plan's next task, with what follows it in
  // the plan and the week's top priorities behind. With no next task the week
  // is done (or had nothing in it), and the card says so instead.
  const deck: DeckTask[] = []
  if (strategy && nextTask) {
    for (const task of [
      nextTask,
      ...followingTasks(strategy, nextTask),
      ...selectTopDynamicTasks(tasks).filter(
        (row) =>
          !isTrackerTaskSetAside(
            {
              skipReason: row.skipReason ?? null,
              snoozedUntil: row.snoozedUntil ?? null,
            },
            new Date(),
          ),
      ),
    ]) {
      if (!deck.some((held) => held.id === task.id)) deck.push(task)
    }
  }
  // Completing or skipping lands at once, so the task has already left the deck;
  // its row stands in front until it has finished leaving.
  const leavingRow = leaving
    ? tasks.find((row) => row.id === leaving.id)
    : undefined
  const stack: DeckTask[] = leavingRow
    ? [leavingRow, ...deck.filter((task) => task.id !== leavingRow.id)]
    : deck
  const frontTask = stack[0]
  const frontRow = tasks.find((row) => row.id === frontTask?.id)

  const activeWeeks =
    strategy?.phases.find((phase) => phase.key === 'active')?.weeks ?? []
  const thisWeek = activeWeeks.find((week) => week.isCurrent)
  // Celebrate only a week that had something in it, all of it finished. A
  // week whose rest was put off or set aside is over, but not finished.
  const weekTasks = thisWeek?.tasks ?? []
  const weekDone =
    weekTasks.length > 0 && weekTasks.every((task) => task.completed)
  const weekSetAside =
    weekTasks.length > 0 &&
    !weekDone &&
    weekTasks.every((task) => task.completed || task.setAside !== null)
  const followingWeek = followingWeekStart(new Date())
  const canHeadStart = activeWeeks.some(
    (week) =>
      week.start === followingWeek &&
      week.tasks.some((task) => !task.completed && task.setAside === null),
  )
  const emptyKind = weekDone ? 'weekDone' : 'caughtUp'

  const taskHeadline = useTaskHeadline(
    heading !== undefined
      ? undefined
      : frontTask
        ? frontRow
        : strategy
          ? { id: emptyKind, title: '', flowType: null, kind: emptyKind }
          : undefined,
    { firstLanding },
  )
  const layersBehind = surface === 'manager' ? Math.min(stack.length - 1, 2) : 0

  if (!strategy) return countModal

  const due = frontTask ? taskDueLabel(frontTask.date, new Date()) : null
  const action = taskAction(frontRow, surface)

  // A task done inside the product (its action opens one of our own screens)
  // should close itself when that work happens, so it offers no manual "Mark
  // as done". Only the story task does so today; outreach still needs the
  // backend to close the task it was launched from. Offline work and external
  // links keep the button, since we can't see them.
  const completesItself = Boolean(action && !action.external)
  const markDone = () => {
    if (!frontTask) return
    // No confirmation: we trust the candidate, and the plan can reopen it.
    // Outreach asks for its voter count first, inside onToggleComplete.
    onToggleComplete(frontTask.id, true)
  }
  const skipFront = (reason: 'later' | 'notForMe') => {
    if (!frontTask) return
    setLeaving({ id: frontTask.id, stage: 'exit', direction: 'down' })
    setAside.mutate({ id: frontTask.id, reason })
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => writeCollapsed(!next)}
      asChild
    >
      <section
        className={cn(
          'flex w-full flex-col',
          surface === 'manager' ? 'gap-6' : 'gap-4',
          className,
        )}
      >
        {/* The whole heading row toggles the section, a bigger target than
            the chevron. The chevron stays the real (keyboard-reachable)
            trigger; it stops its click here so one press toggles once. */}
        <div
          className={cn(
            'flex items-start justify-between gap-4',
            collapsible && 'cursor-pointer',
          )}
          onClick={collapsible ? () => writeCollapsed(open) : undefined}
        >
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
              {heading ?? taskHeadline ?? '\u00a0'}
            </h2>
          </div>
          {collapsible && (
            <CollapsibleTrigger asChild>
              <IconButton
                type="button"
                variant="ghost"
                size="small"
                onClick={(event) => event.stopPropagation()}
                aria-label={
                  open ? 'Hide your next step' : 'Show your next step'
                }
                className={cn(
                  'shrink-0',
                  tone === 'inverse' &&
                    'text-primary-foreground hover:bg-primary-foreground/10',
                )}
              >
                <ChevronDownIcon
                  className={cn(
                    'size-4 transition-transform',
                    open && 'rotate-180',
                  )}
                  aria-hidden
                />
              </IconButton>
            </CollapsibleTrigger>
          )}
        </div>
        <CollapsibleContent>
          {frontTask ? (
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
              <Card
                key={frontTask.id}
                onAnimationEnd={(event) => {
                  if (event.target === event.currentTarget) setArriving(false)
                }}
                className={cn(
                  'relative min-h-20 gap-0 rounded-2xl border-components-input-border py-0',
                  leaving && 'pointer-events-none',
                  leaving?.stage === 'exit' &&
                    'animate-out fade-out fill-mode-forwards duration-300 motion-reduce:animate-none',
                  leaving?.stage === 'exit' &&
                    (leaving.direction === 'up'
                      ? 'slide-out-to-top-8'
                      : 'slide-out-to-bottom-8'),
                  !leaving &&
                    arriving &&
                    'animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none',
                )}
              >
                <div className="flex flex-col gap-1 px-6 py-5">
                  {/* No overline: the title leads. See design-memory learned.md. */}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-opensans text-lg font-medium text-card-foreground">
                      {frontTask.title}
                    </h3>
                    {/* The choice is the confirmation: put it off, or (for a
                        task the race can do without) set it aside for good. */}
                    {!leaving && (
                      <DropdownMenu>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <IconButton
                                type="button"
                                variant="ghost"
                                size="small"
                                aria-label="Skip this task"
                                className="-mt-1 -mr-2 shrink-0"
                              >
                                <XMarkIcon className="size-5" aria-hidden />
                              </IconButton>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent side="top">Skip</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => skipFront('later')}>
                            {snoozeLabel(frontTask.date)}
                          </DropdownMenuItem>
                          {canSetTaskAsideForGood(frontTask.title) && (
                            <DropdownMenuItem
                              onSelect={() => skipFront('notForMe')}
                            >
                              Don’t suggest it again
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {frontTask.description}
                  </p>
                  {/* After the description, so the title and description
                      read as one thought and the date sits by the actions. */}
                  {due && (
                    <p
                      className={cn(
                        'mt-1 flex items-center gap-1.5 text-sm',
                        due.urgent
                          ? 'text-warning-dark'
                          : 'text-muted-foreground',
                      )}
                    >
                      <CalendarIcon className="size-4 shrink-0" aria-hidden />
                      {due.label}
                    </p>
                  )}
                  <div className="flex flex-col gap-2 pt-3 sm:flex-row sm:flex-wrap">
                    <>
                      {action && (
                        <Button
                          asChild
                          size="medium"
                          className="w-full sm:w-auto"
                        >
                          {action.external ? (
                            <a
                              href={action.href}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {action.label}
                              <ExternalLinkIcon
                                className="size-4"
                                aria-hidden
                              />
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
                          size="medium"
                          className="w-full sm:w-auto"
                          onClick={markDone}
                        >
                          <ConfettiBurst
                            play={
                              leaving?.id === frontTask.id &&
                              leaving.direction === 'up'
                            }
                            style={{ width: 16, height: 16 }}
                          >
                            <CheckIcon className="size-4" aria-hidden />
                          </ConfettiBurst>
                          Mark as done
                        </Button>
                      )}
                      {chat && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="medium"
                          className="w-full sm:ml-auto sm:w-auto"
                          onClick={() =>
                            chat.discussTask(discussTaskMessage(frontTask))
                          }
                        >
                          <MessagesSquareIcon className="size-4" aria-hidden />
                          Ask about this
                        </Button>
                      )}
                    </>
                  </div>
                </div>
              </Card>
            </div>
          ) : (
            <EmptyState
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) setArriving(false)
              }}
              className={cn(
                'rounded-2xl border-components-input-border',
                arriving &&
                  'animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none',
              )}
              title={
                weekDone
                  ? 'You finished this week’s tasks'
                  : weekSetAside
                    ? 'Nothing left for this week'
                    : 'Nothing due this week'
              }
              message={
                canHeadStart
                  ? 'Next week’s tasks are ready when you are.'
                  : 'Check back next week.'
              }
              action={
                canHeadStart && (
                  <Button
                    type="button"
                    size="medium"
                    onClick={() => writeHeadStart(followingWeek)}
                  >
                    Get a head start
                  </Button>
                )
              }
            />
          )}
        </CollapsibleContent>
        {countModal}
      </section>
    </Collapsible>
  )
}

export default NextTaskCard
