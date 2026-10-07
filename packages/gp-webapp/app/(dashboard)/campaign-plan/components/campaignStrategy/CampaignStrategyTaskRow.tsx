'use client'

import { format } from 'date-fns'
import {
  TRACKER_TASK_SNOOZE_DAYS,
  type TrackerTaskSkipReason,
} from '@goodparty_org/contracts'
import {
  Badge,
  Button,
  CalendarDaysIcon,
  CalendarIcon,
  ClipboardListIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  MoreHorizontalIcon,
  ExternalLinkIcon,
  LockIcon,
  MailIcon,
  MapPinIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  PhoneIcon,
  cn,
} from '@styleguide'
import NextThingCard from 'app/(dashboard)/home/NextThingCard'
import type {
  CampaignStrategyTask,
  TaskChannel,
} from './campaignStrategy.types'

interface CampaignStrategyTaskRowProps {
  task: CampaignStrategyTask
  onToggleComplete?: (id: string, completed: boolean) => void
  // Sets a task aside for a few days ('later') or for good ('notForMe').
  onSkip?: (id: string, reason: TrackerTaskSkipReason) => void
  // Brings back a task the candidate said is not for them.
  onUndoSkip?: (id: string) => void
  // In-place launcher for text/robocall tasks (legacy-task behavior): opens
  // the outreach flow with the task's due date instead of navigating.
  onStartOutreach?: (
    channel: 'text' | 'robocall',
    date: string | null,
    taskId: string,
  ) => void
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

// One task row: date chip, type icon, title, optional Pro badge, description,
// parameter, prerequisite hint, link, and a "…" menu with what can be done to
// it (the same choices as Home's card).
const isComposeChannel = (
  channel: TaskChannel,
): channel is 'text' | 'robocall' =>
  channel === 'text' || channel === 'robocall'

const SKIP_CHOICES: {
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

const TaskActionsMenu = ({
  task,
  setAside,
  onToggleComplete,
  onSkip,
}: {
  task: CampaignStrategyTask
  setAside: boolean
  onToggleComplete?: (id: string, completed: boolean) => void
  onSkip?: (id: string, reason: TrackerTaskSkipReason) => void
}): React.JSX.Element => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <IconButton
        type="button"
        variant="ghost"
        size="small"
        className="-mr-2 -mt-1 shrink-0 text-muted-foreground"
        aria-label={`Options for ${task.title}`}
      >
        <MoreHorizontalIcon className="size-5" aria-hidden />
      </IconButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {task.completed ? (
        onToggleComplete && (
          <DropdownMenuItem onSelect={() => onToggleComplete(task.id, false)}>
            Mark not done
          </DropdownMenuItem>
        )
      ) : (
        <>
          {onToggleComplete && (
            <DropdownMenuItem onSelect={() => onToggleComplete(task.id, true)}>
              Mark done
            </DropdownMenuItem>
          )}
          {onSkip &&
            SKIP_CHOICES.filter(
              (choice) => !(setAside && choice.reason === 'notForMe'),
            ).map((choice) => (
              <DropdownMenuItem
                key={choice.reason}
                onSelect={() => onSkip(task.id, choice.reason)}
                className="flex flex-col items-start gap-0"
              >
                <span>{choice.label}</span>
                <span className="text-xs text-muted-foreground">
                  {choice.caption}
                </span>
              </DropdownMenuItem>
            ))}
        </>
      )}
    </DropdownMenuContent>
  </DropdownMenu>
)

const CampaignStrategyTaskRow = ({
  task,
  onToggleComplete,
  onSkip,
  onUndoSkip,
  onStartOutreach,
}: CampaignStrategyTaskRowProps): React.JSX.Element => {
  // The next task is the same card Home shows, in its place in the list, so
  // the candidate sees what to do now among what came before and after it.
  // NextThingCard picks the task itself through the same selectNextTrackerTask
  // that set isNext here, so the two always agree.
  if (task.isNext && !task.completed) {
    return (
      <li className="border-border block border-t px-4 py-4 first:border-t-0 sm:px-6">
        <NextThingCard surface="plan" />
      </li>
    )
  }

  const formattedDate = formatTaskDate(task.date)
  const setAside = !task.completed && task.skipReason === 'notForMe'
  const Icon = CHANNEL_ICONS[task.channel]
  const composeChannel = isComposeChannel(task.channel) ? task.channel : null

  return (
    <li className="border-border flex gap-2 border-t px-6 py-4 first:border-t-0">
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
              setAside && 'text-muted-foreground',
            )}
          >
            {task.title}
          </span>
          {setAside && (
            <Badge className="text-muted-foreground border-border bg-transparent font-normal">
              Not for me
            </Badge>
          )}
          {task.proRequired && (
            <Badge className="border-transparent bg-secondary text-secondary-foreground">
              Pro
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-sm">{task.description}</p>
        {setAside && onUndoSkip && (
          <Button
            type="button"
            variant="link"
            size="small"
            className="text-primary h-auto p-0"
            onClick={() => onUndoSkip(task.id)}
          >
            Undo
          </Button>
        )}
        {task.param && (
          <p className="text-muted-foreground text-xs">{task.param}</p>
        )}
        {task.unlocksAfter && (
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <LockIcon className="size-3" />
            Unlocks after {task.unlocksAfter}
          </p>
        )}
        {!task.href && !task.completed && onStartOutreach && composeChannel && (
          <Button
            type="button"
            variant="link"
            size="small"
            className="text-primary h-auto p-0"
            onClick={() => onStartOutreach(composeChannel, task.date, task.id)}
          >
            Start outreach
          </Button>
        )}
        {task.href && (
          <Button
            asChild
            variant="link"
            size="small"
            className="text-primary h-auto p-0"
          >
            {task.href.startsWith('/') ? (
              <a href={task.href}>
                {task.hrefLabel ?? 'Open'}
                <ExternalLinkIcon className="size-3" />
              </a>
            ) : (
              <a href={task.href} target="_blank" rel="noreferrer">
                {task.hrefLabel ?? 'Open'}
                <ExternalLinkIcon className="size-3" />
              </a>
            )}
          </Button>
        )}
      </div>
      {(onToggleComplete || onSkip) && (
        <TaskActionsMenu
          task={task}
          setAside={setAside}
          onToggleComplete={onToggleComplete}
          onSkip={onSkip}
        />
      )}
    </li>
  )
}

export default CampaignStrategyTaskRow
