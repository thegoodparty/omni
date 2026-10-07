'use client'

import { format } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MoreMenu } from 'app/shared/utils/MoreMenu'
import {
  Badge,
  Button,
  CalendarDaysIcon,
  CalendarIcon,
  CheckIcon,
  ClipboardListIcon,
  LockIcon,
  MailIcon,
  MapPinIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  PhoneIcon,
  cn,
} from '@styleguide'
import type {
  CampaignStrategyTask,
  TaskChannel,
} from './campaignStrategy.types'

interface CampaignStrategyTaskRowProps {
  task: CampaignStrategyTask
  index: number
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
  // Skips the task in the shared next-task stack; offered on the "Do this
  // next" row only.
  onSkip?: (task: CampaignStrategyTask) => void
}

const CHANNEL_ICONS: Record<
  TaskChannel,
  React.ComponentType<{ className?: string }>
> = {
  text: MessageSquareIcon,
  robocall: PhoneIcon,
  phoneBanking: PhoneIcon,
  doorKnocking: MapPinIcon,
  socialMedia: MegaphoneIcon,
  directMail: MailIcon,
  event: CalendarIcon,
  awareness: CalendarDaysIcon,
  general: ClipboardListIcon,
}

// The catalog fallback passes date-only strings ("2026-07-11"); the tracker
// passes the API's full ISO datetime ("2026-07-11T00:00:00.000Z"). Slice to the
// date portion before the Safari-safe dash->slash local-midnight parse so both
// render — the full ISO form would otherwise become an Invalid Date and throw.
export const formatTaskDate = (date: string | null): string | null =>
  date ? format(new Date(date.slice(0, 10).replace(/-/g, '/')), 'MMM d') : null

// One task row: status marker, date chip, type icon, title, optional Pro and
// "Do this next" badges, description, parameter, prerequisite hint, a chat
// action, and a menu holding the task's own actions.
const isComposeChannel = (
  channel: TaskChannel,
): channel is 'text' | 'robocall' =>
  channel === 'text' || channel === 'robocall'

const CampaignStrategyTaskRow = ({
  task,
  index,
  onToggleComplete,
  onStartOutreach,
  onDiscuss,
  getAction,
  onSkip,
}: CampaignStrategyTaskRowProps): React.JSX.Element => {
  const router = useRouter()
  const formattedDate = formatTaskDate(task.date)
  const Icon = CHANNEL_ICONS[task.channel]
  const composeChannel = isComposeChannel(task.channel) ? task.channel : null

  const markerClassName = cn(
    'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
    task.completed
      ? 'bg-success text-white'
      : task.isNext
        ? 'bg-primary text-white'
        : 'bg-grayscale-200 text-muted-foreground',
  )
  const markerContent = task.completed ? (
    <CheckIcon className="size-4" />
  ) : (
    String(index).padStart(2, '0')
  )

  // Every action that does or closes the task lives in the row's menu, so the
  // row itself only offers chat.
  const href = task.href
  const resolvedAction = getAction ? getAction(task) : null
  const action = task.completed ? null : resolvedAction
  // Same rule as the next-task card: work done on our own screens should close
  // itself, so only offline tasks and external links get a manual toggle.
  const completesItself = Boolean(resolvedAction && !resolvedAction.external)
  // The "Do this next" row leads with its action as a real button, like the
  // next-task card; every other row keeps it in the menu.
  const actionInRow = Boolean(action && task.isNext)
  const menuItems = [
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
    ...(onSkip && task.isNext && !task.completed
      ? [{ label: 'Skip', onClick: () => onSkip(task) }]
      : []),
    ...(onToggleComplete && !completesItself
      ? [
          {
            label: task.completed ? 'Mark as not done' : 'Mark as done',
            onClick: () => onToggleComplete(task.id, !task.completed),
          },
        ]
      : []),
  ]

  return (
    <li
      // The plan page scrolls this row into view on arrival.
      data-next-task={task.isNext && !task.completed ? true : undefined}
      className={cn(
        'border-border flex gap-4 border-t px-6 py-4 first:border-t-0',
        task.isNext && 'bg-primary/5',
      )}
    >
      <span className={markerClassName}>{markerContent}</span>
      <div className="flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {formattedDate && (
            <Badge className="text-muted-foreground border-border rounded-full bg-transparent font-normal tabular-nums">
              {formattedDate}
            </Badge>
          )}
          <Icon className="text-muted-foreground size-4 shrink-0" />
          <span
            className={cn(
              'text-sm font-semibold',
              task.completed && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </span>
          {task.isNext && (
            <Badge className="border-transparent bg-primary/10 text-primary">
              Do this next
            </Badge>
          )}
          {task.proRequired && (
            <Badge className="border-transparent bg-secondary text-secondary-foreground">
              Pro
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-sm">{task.description}</p>
        {task.param && (
          <p className="text-muted-foreground text-xs">{task.param}</p>
        )}
        {task.unlocksAfter && (
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <LockIcon className="size-3" />
            Unlocks after {task.unlocksAfter}
          </p>
        )}
        {(actionInRow || onDiscuss) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {action && actionInRow && (
              <Button asChild size="small">
                {action.external ? (
                  <a href={action.href} target="_blank" rel="noreferrer">
                    {action.label}
                  </a>
                ) : (
                  <Link href={action.href}>{action.label}</Link>
                )}
              </Button>
            )}
            {onDiscuss && (
              <Button
                type="button"
                variant="ghost"
                size="small"
                className={cn(
                  'text-primary hover:bg-primary/5',
                  !actionInRow && '-ml-3',
                )}
                onClick={() => onDiscuss(task)}
              >
                <MessageSquareIcon className="size-4" aria-hidden />
                Ask about this
              </Button>
            )}
          </div>
        )}
      </div>
      {menuItems.length > 0 && (
        <div className="shrink-0">
          <MoreMenu menuItems={menuItems} />
        </div>
      )}
    </li>
  )
}

export default CampaignStrategyTaskRow
