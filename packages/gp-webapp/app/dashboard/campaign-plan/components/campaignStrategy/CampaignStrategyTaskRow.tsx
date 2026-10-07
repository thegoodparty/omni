'use client'

import { differenceInCalendarDays, format, startOfDay } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MoreMenu } from 'app/shared/utils/MoreMenu'
import {
  TRACKER_TASK_SNOOZE_DAYS,
  canSetTaskAsideForGood,
  canPutOffTask,
  type TrackerTaskSkipReason,
} from '@goodparty_org/contracts'
import {
  Badge,
  Button,
  CalendarIcon,
  CheckIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  LockIcon,
  MessagesSquareIcon,
  cn,
} from '@styleguide'
import type {
  CampaignStrategyTask,
  TaskChannel,
} from './campaignStrategy.types'

interface CampaignStrategyTaskRowProps {
  task: CampaignStrategyTask
  onToggleComplete?: (id: string, completed: boolean) => void
  // In-place launcher for text/robocall tasks (legacy-task behavior): opens
  // the outreach flow with the task's due date instead of navigating.
  onStartOutreach?: (
    channel: 'text' | 'robocall',
    date: string | null,
    taskId: string,
  ) => void
  // Opens the Campaign Manager chat about this task; the row's one visible
  // action. Everything else it can do sits in its menu.
  onDiscuss?: (task: CampaignStrategyTask) => void
  // The task's real action (the same mapping the next-task card leads with).
  // When given, it replaces the older link / "Start outreach" menu items.
  getAction?: (
    task: CampaignStrategyTask,
  ) => { label: string; href: string; external: boolean } | null
  // Puts the task off or sets it aside (offered on the "Do this next" row),
  // or brings a set-aside task back (null).
  onSetAside?: (
    task: CampaignStrategyTask,
    reason: TrackerTaskSkipReason | null,
  ) => void
}

// The catalog fallback passes date-only strings ("2026-07-11"); the tracker
// passes the API's full ISO datetime ("2026-07-11T00:00:00.000Z"). Slice to the
// date portion before the Safari-safe dash->slash local-midnight parse so both
// render — the full ISO form would otherwise become an Invalid Date and throw.
export const formatTaskDate = (date: string | null): string | null =>
  date ? format(new Date(date.slice(0, 10).replace(/-/g, '/')), 'MMM d') : null

// "Later" moves the task's date three days out.
export const PUT_OFF_LABEL = `Show in ${TRACKER_TASK_SNOOZE_DAYS} days`

// A task's due line, on the next-step card and the plan's rows. Plain and muted while the date is a while off; once it
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

// One task row, in the Home card's order: title (with its New and "Do this
// next" badges), description, date, then any parameter or prerequisite.
// The next task shows its buttons; every other row a menu of its actions.
const isComposeChannel = (
  channel: TaskChannel,
): channel is 'text' | 'robocall' =>
  channel === 'text' || channel === 'robocall'

const CampaignStrategyTaskRow = ({
  task,
  onToggleComplete,
  onStartOutreach,
  onDiscuss,
  getAction,
  onSetAside,
}: CampaignStrategyTaskRowProps): React.JSX.Element => {
  const router = useRouter()
  const composeChannel = isComposeChannel(task.channel) ? task.channel : null

  // Every action that does or closes the task lives in the row's menu, asking
  // about it included; only the next task also shows its action in place.
  const href = task.href
  const resolvedAction = getAction ? getAction(task) : null
  const action = task.completed ? null : resolvedAction
  // Same rule as the next-task card: work done on our own screens should close
  // itself, so only offline tasks and external links get a manual toggle.
  const completesItself = Boolean(resolvedAction && !resolvedAction.external)
  // The "Do this next" row leads with its action as a real button, like the
  // next-task card; every other row keeps it in the menu.
  const actionInRow = Boolean(action && task.isNext)
  // The task's own action: the mapped one, or for rows without one, starting
  // outreach or opening its link.
  const actionItems = [
    ...(action && !actionInRow
      ? [
          {
            label: action.label,
            onClick: () => {
              if (action.external)
                window.open(action.href, '_blank', 'noreferrer')
              else router.push(action.href)
            },
          },
        ]
      : []),
    ...(!getAction &&
    !href &&
    !task.completed &&
    onStartOutreach &&
    composeChannel
      ? [
          {
            label: 'Start outreach',
            onClick: () => onStartOutreach(composeChannel, task.date, task.id),
          },
        ]
      : []),
    ...(!getAction && href
      ? [
          {
            label: task.hrefLabel ?? 'Open',
            onClick: () => {
              if (href.startsWith('/')) router.push(href)
              else window.open(href, '_blank', 'noreferrer')
            },
          },
        ]
      : []),
  ]
  const markDoneItems =
    onToggleComplete && !completesItself
      ? [
          {
            label: 'Mark as done',
            onClick: () => onToggleComplete(task.id, true),
          },
        ]
      : []
  // The main action leads, then asking about it; with no action of its own,
  // marking it done is the main action.
  const putOff = canPutOffTask(task.title)
  const notForMe = canSetTaskAsideForGood(task.title)
  const openTaskItems = [
    ...(actionItems.length > 0 ? actionItems : markDoneItems),
    ...(onDiscuss
      ? [{ label: 'Ask about this', onClick: () => onDiscuss(task) }]
      : []),
    ...(actionItems.length > 0 ? markDoneItems : []),
    // Any open task can be put off or set aside, not only the next one.
    ...(onSetAside && !task.setAside && putOff
      ? [{ label: PUT_OFF_LABEL, onClick: () => onSetAside(task, 'later') }]
      : []),
    ...(onSetAside && !task.setAside && notForMe
      ? [{ label: 'Not for me', onClick: () => onSetAside(task, 'notForMe') }]
      : []),
    ...(onSetAside && task.setAside
      ? [{ label: 'Bring it back', onClick: () => onSetAside(task, null) }]
      : []),
  ]
  // A done task has nothing left to do, so its menu only undoes that.
  const menuItems = task.completed
    ? onToggleComplete && !completesItself
      ? [
          {
            label: 'Mark as not done',
            onClick: () => onToggleComplete(task.id, false),
          },
        ]
      : []
    : openTaskItems

  // The next task opens up like the Home card: its buttons in place of the
  // menu. Every other row keeps its actions in the menu.
  const showButtons = task.isNext && !task.completed
  // One line says where the task stands, in the spot the date takes on an
  // open task: done, not for me, or when it's due. Words and an icon, so it
  // never rests on color alone.
  const due =
    task.completed || task.setAside ? null : taskDueLabel(task.date, new Date())

  return (
    <li
      // The plan page scrolls this row into view on arrival.
      data-next-task={showButtons ? true : undefined}
      className={cn(
        'border-border flex gap-4 border-t px-6 py-4 first:border-t-0',
        task.isNext && 'bg-primary/5',
      )}
    >
      {/* Title, description, then the date, in the Home card's order. */}
      <div className="flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'text-sm font-semibold',
              (task.completed || task.setAside) && 'text-muted-foreground',
            )}
          >
            {task.title}
          </span>
          {task.isNext && (
            <Badge className="border-transparent bg-primary/10 text-primary">
              Do this next
            </Badge>
          )}
          {task.isNew && !task.isNext && <Badge variant="outline">New</Badge>}
        </div>
        <p className="text-muted-foreground text-sm">{task.description}</p>
        {task.param && (
          <p className="text-muted-foreground text-xs">{task.param}</p>
        )}
        {task.completed ? (
          <p className="text-success-dark mt-1 flex items-center gap-1.5 text-sm">
            <CheckIcon className="size-4 shrink-0" aria-hidden />
            Done
          </p>
        ) : task.setAside ? (
          <p className="text-muted-foreground mt-1 text-sm">Not for me</p>
        ) : (
          due && (
            <p
              className={cn(
                'mt-1 flex items-center gap-1.5 text-sm',
                due.urgent ? 'text-warning-dark' : 'text-muted-foreground',
              )}
            >
              <CalendarIcon className="size-4 shrink-0" aria-hidden />
              {due.label}
            </p>
          )
        )}
        {task.unlocksAfter && (
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <LockIcon className="size-3" />
            Unlocks after {task.unlocksAfter}
          </p>
        )}
        {showButtons && (
          <div className="flex flex-col gap-2 pt-3 sm:flex-row sm:flex-wrap">
            {action && (
              <Button asChild size="medium" className="w-full sm:w-auto">
                {action.external ? (
                  <a href={action.href} target="_blank" rel="noreferrer">
                    {action.label}
                  </a>
                ) : (
                  <Link href={action.href}>{action.label}</Link>
                )}
              </Button>
            )}
            {onToggleComplete && !completesItself && (
              <Button
                type="button"
                variant={action ? 'outline' : 'default'}
                size="medium"
                className="w-full sm:w-auto"
                onClick={() => onToggleComplete(task.id, true)}
              >
                <CheckIcon className="size-4" aria-hidden />
                Mark as done
              </Button>
            )}
            {onDiscuss && (
              <Button
                type="button"
                variant="ghost"
                size="medium"
                className="w-full sm:w-auto"
                onClick={() => onDiscuss(task)}
              >
                <MessagesSquareIcon className="size-4" aria-hidden />
                Ask about this
              </Button>
            )}
            {onSetAside && (putOff || notForMe) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="medium"
                    className="w-full sm:ml-auto sm:w-auto"
                  >
                    Skip
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {putOff && (
                    <DropdownMenuItem
                      onSelect={() => onSetAside(task, 'later')}
                    >
                      {PUT_OFF_LABEL}
                    </DropdownMenuItem>
                  )}
                  {notForMe && (
                    <DropdownMenuItem
                      onSelect={() => onSetAside(task, 'notForMe')}
                    >
                      Not for me
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
      {!showButtons && menuItems.length > 0 && (
        <div className="shrink-0">
          <MoreMenu menuItems={menuItems} />
        </div>
      )}
    </li>
  )
}

export default CampaignStrategyTaskRow
