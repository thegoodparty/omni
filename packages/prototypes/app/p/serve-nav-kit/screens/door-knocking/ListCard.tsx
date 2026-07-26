'use client'

import { forwardRef, useMemo } from 'react'
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  cn,
} from '@goodparty_org/styleguide'
import {
  BookmarkPlus,
  Clock,
  EyeOff,
  Footprints,
  Home,
  MoreVertical,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import {
  type ListColor,
  type Voter,
  DEFAULT_LIST_COLOR,
  LIST_COLOR_TOKEN,
  getHouseholdCount,
} from './doorKnockingData'

type Props = {
  variant: 'recommended' | 'saved'
  title: string
  voters: Voter[]
  duration: string
  reason?: string
  color?: ListColor
  isActive?: boolean
  onClick: () => void
  onWalk?: () => void
  onDetails?: () => void
  onDelete?: () => void
  onSave?: () => void
}

export const ListCard = forwardRef<HTMLDivElement, Props>(function ListCard(
  {
    variant,
    title,
    voters,
    duration,
    reason,
    color,
    isActive,
    onClick,
    onWalk,
    onDetails,
    onDelete,
    onSave,
  },
  ref,
) {
  const households = voters.length
  const people = useMemo(
    () => voters.reduce((sum, v) => sum + getHouseholdCount(v), 0),
    [voters],
  )
  const completed = useMemo(
    () => voters.filter((v) => v.reached).length,
    [voters],
  )
  const isSaved = variant === 'saved'

  return (
    <Card
      ref={ref}
      onClick={onClick}
      className={cn(
        'relative cursor-pointer gap-0 overflow-hidden p-4 transition-colors',
        isActive ? 'border-primary border-2' : 'hover:bg-muted/50',
        isSaved && 'pl-5',
      )}
    >
      {isSaved && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1.5"
          style={{
            backgroundColor: `color-mix(in srgb, ${
              LIST_COLOR_TOKEN[color ?? DEFAULT_LIST_COLOR]
            } 78%, black)`,
          }}
        />
      )}

      {onDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              variant="ghost"
              size="small"
              aria-label="List options"
              onClick={(e) => e.stopPropagation()}
              className="absolute top-1 right-1"
            >
              <MoreVertical className="size-4" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4}>
            <DropdownMenuItem
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              {isSaved ? (
                <>
                  <Trash2 className="size-4" />
                  Delete list
                </>
              ) : (
                <>
                  <EyeOff className="size-4" />
                  Dismiss
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="mb-2 flex h-4 items-center pr-8">
        {!isSaved ? (
          <span className="text-primary inline-flex items-center gap-1 text-xs font-semibold tracking-wide uppercase">
            <Sparkles className="size-3" />
            Recommended
          </span>
        ) : (
          <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {completed.toLocaleString()} / {households.toLocaleString()} doors
            knocked
          </span>
        )}
      </div>

      <h3
        title={title}
        className="text-foreground line-clamp-2 pr-8 text-sm leading-snug font-semibold"
      >
        {title}
      </h3>

      {!isSaved && reason && (
        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-snug">
          {reason}
        </p>
      )}

      <div className="text-muted-foreground mt-2.5 flex items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <Home className="size-3.5" />
          {households.toLocaleString()}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" />
          {people.toLocaleString()}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-3.5" />
          {duration}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-end gap-1">
        {onDetails && (
          <Button
            variant="ghost"
            size="small"
            className="text-primary"
            onClick={(e) => {
              e.stopPropagation()
              onDetails()
            }}
          >
            Details
          </Button>
        )}
        {isSaved && onWalk && (
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              onWalk()
            }}
          >
            <Footprints className="size-3.5" />
            Knock
          </Button>
        )}
        {!isSaved && onSave && (
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              onSave()
            }}
          >
            <BookmarkPlus className="size-3.5" />
            Save
          </Button>
        )}
      </div>
    </Card>
  )
})
