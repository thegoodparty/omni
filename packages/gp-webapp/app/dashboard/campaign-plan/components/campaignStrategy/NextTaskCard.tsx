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
  ChevronDownIcon,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  IconButton,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CheckIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  Overline,
  cn,
} from '@styleguide'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useCampaignManagerChat } from 'app/dashboard/campaign-manager/CampaignManagerChatProvider'
import { PHASE_META, buildTrackerStrategy } from './buildTrackerStrategy'
import { formatTaskDate } from './CampaignStrategyTaskRow'
import { useCompleteTrackerTask } from './useCompleteTrackerTask'
import { isVoterContactFlowType, useTrackerTasks } from './useTrackerTasks'
import { selectTopDynamicTasks } from 'app/dashboard/campaign-manager/selectTopDynamicTasks'
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
}

// Sent as the candidate's first message, so the manager answers about this
// task instead of opening on its greeting.
const discussTaskMessage = (task: DeckTask): string => {
  const due = formatTaskDate(task.date)
  return [
    `Help me with this task from my campaign plan: "${task.title}".`,
    task.description,
    due ? `It is due ${due}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// The task's own action, as the tracker rows and the manager's priority cards
// offered it: its link ("Open", or the row's own cta), else "Start outreach"
// for text and robocall tasks. Anything else is work done off the product
// (build a call list, pick a treasurer), so "Discuss in chat" leads: it is
// where the manager helps do it, and leading with "Mark as done" would ask the
// candidate to close a task they have not started.
const taskAction = (
  row: CampaignTrackerTask | undefined,
  surface: 'plan' | 'manager',
): { label: string; href: string; external: boolean } | null => {
  if (!row) return null
  const cta = row.cta?.trim()
  const link = row.link?.trim()
  if (link) {
    return { label: cta || 'Open', href: link, external: !link.startsWith('/') }
  }
  if (row.flowType === 'text' || row.flowType === 'robocall') {
    return {
      label: cta || 'Start outreach',
      href: composeOutreachHref(
        row.flowType,
        surface === 'manager' ? 'campaign_manager' : 'campaign_tracker',
        row.date,
        parseTrackerOrigin(row.id, row.phase),
      ),
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

const subscribeSkipped = (listener: () => void): (() => void) => {
  skipListeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    skipListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

const NO_SKIPS: string[] = []

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
  subheading,
  surface,
  className,
}: {
  heading: string
  subheading?: string
  // Both surfaces hold the same stack (the next task, then this week's top
  // priorities) and the same skips, so they always show the same front card.
  // Only the manager draws the cards behind it; the plan has the full list
  // below.
  surface: 'plan' | 'manager'
  className?: string
}): React.JSX.Element | null => {
  const [campaign] = useCampaign()
  const { tasks } = useTrackerTasks()
  const chat = useCampaignManagerChat()
  const { onToggleComplete, countModal } = useCompleteTrackerTask(tasks)
  const [confirmTaskId, setConfirmTaskId] = useState<string | null>(null)
  // The plan's next step leads the page but can be folded away. The manager's
  // card is the page itself, so it always stays open.
  const collapsible = surface === 'plan'
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => false,
  )
  const open = !collapsible || !collapsed
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

  const deck: DeckTask[] = [
    ...(nextTask ? [nextTask] : []),
    ...selectTopDynamicTasks(tasks).filter((task) => task.id !== nextTask?.id),
  ]
  // Skipping sends a card to the back of the stack, in the order skipped. Only
  // for this visit: it reorders the stack, it does not reschedule the task.
  const skipRank = (id: string) => skippedIds.indexOf(id)
  deck.sort((a, b) => skipRank(a.id) - skipRank(b.id))
  const frontTask = deck[0]
  const layersBehind = surface === 'manager' ? Math.min(deck.length - 1, 2) : 0

  if (!frontTask) return countModal

  const frontPhase = tasks.find((row) => row.id === frontTask.id)?.phase
  const phaseTitle = PHASE_META.find((phase) => phase.key === frontPhase)?.title
  const dueDate = formatTaskDate(frontTask.date)
  const action = taskAction(
    tasks.find((row) => row.id === frontTask.id),
    surface,
  )

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => writeCollapsed(!next)}
      asChild
    >
      <section className={cn('flex w-full flex-col gap-4', className)}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2
              className={
                surface === 'manager'
                  ? 'text-2xl font-semibold text-foreground'
                  : 'text-lg font-medium text-foreground'
              }
            >
              {heading}
            </h2>
            {subheading && (
              <p className="text-base text-muted-foreground">{subheading}</p>
            )}
          </div>
          {collapsible && (
            <CollapsibleTrigger asChild>
              <IconButton
                type="button"
                variant="ghost"
                size="small"
                aria-label={
                  open ? 'Hide your next step' : 'Show your next step'
                }
                className="shrink-0"
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
              <div className="flex flex-col gap-1 px-6 py-5">
                {phaseTitle && <Overline>{phaseTitle}</Overline>}
                <h3 className="font-opensans text-lg font-medium text-card-foreground">
                  {frontTask.title}
                </h3>
                {dueDate && (
                  <p className="text-muted-foreground text-sm">Due {dueDate}</p>
                )}
                <p className="text-muted-foreground text-sm">
                  {frontTask.description}
                </p>
                <div className="flex flex-wrap gap-2 pt-3">
                  {action && (
                    <Button asChild size="small">
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
                  {chat && (
                    <Button
                      type="button"
                      variant={action ? 'outline' : 'default'}
                      size="small"
                      onClick={() =>
                        chat.discussTask(discussTaskMessage(frontTask))
                      }
                    >
                      <MessageSquareIcon className="size-4" aria-hidden />
                      Discuss in chat
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant={action || chat ? 'outline' : 'default'}
                    size="small"
                    onClick={() => {
                      const row = tasks.find((task) => task.id === frontTask.id)
                      // The count modal already stands in front of these.
                      if (isVoterContactFlowType(row?.flowType ?? null)) {
                        onToggleComplete(frontTask.id, true)
                        return
                      }
                      setConfirmTaskId(frontTask.id)
                    }}
                  >
                    <CheckIcon className="size-4" aria-hidden />
                    Mark as done
                  </Button>
                  {deck.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="small"
                      className="ml-auto"
                      onClick={() =>
                        writeSkipped([
                          ...skippedIds.filter((id) => id !== frontTask.id),
                          frontTask.id,
                        ])
                      }
                    >
                      Skip
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </CollapsibleContent>
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
    </Collapsible>
  )
}

export default NextTaskCard
