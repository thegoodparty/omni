'use client'

import { format } from 'date-fns'
import {
  Badge,
  Button,
  CalendarDaysIcon,
  CalendarIcon,
  CheckIcon,
  ClipboardListIcon,
  ExternalLinkIcon,
  LockIcon,
  MailIcon,
  MapPinIcon,
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
}

const CHANNEL_ICONS: Record<
  TaskChannel,
  React.ComponentType<{ className?: string }>
> = {
  text: MessageSquareIcon,
  robocall: PhoneIcon,
  phoneBanking: PhoneIcon,
  doorKnocking: MapPinIcon,
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
// "Do this next" badges, description, parameter, prerequisite hint, link.
const CampaignStrategyTaskRow = ({
  task,
  index,
  onToggleComplete,
}: CampaignStrategyTaskRowProps): React.JSX.Element => {
  const formattedDate = formatTaskDate(task.date)
  const Icon = CHANNEL_ICONS[task.channel]

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

  return (
    <li
      className={cn(
        'border-border flex gap-4 border-t px-6 py-4 first:border-t-0',
        task.isNext && 'bg-primary/5',
      )}
    >
      {onToggleComplete ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onToggleComplete(task.id, !task.completed)}
          aria-pressed={task.completed}
          aria-label={
            task.completed ? 'Mark task incomplete' : 'Mark task complete'
          }
          className={cn(markerClassName, 'p-0 hover:opacity-80')}
        >
          {markerContent}
        </Button>
      ) : (
        <span className={markerClassName}>{markerContent}</span>
      )}
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
          {task.isNext && <Badge>Do this next</Badge>}
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
        {task.href && (
          <Button
            asChild
            variant="link"
            size="small"
            className="text-primary h-auto p-0"
          >
            <a href={task.href} target="_blank" rel="noreferrer">
              {task.hrefLabel ?? 'Open'}
              <ExternalLinkIcon className="size-3" />
            </a>
          </Button>
        )}
      </div>
    </li>
  )
}

export default CampaignStrategyTaskRow
