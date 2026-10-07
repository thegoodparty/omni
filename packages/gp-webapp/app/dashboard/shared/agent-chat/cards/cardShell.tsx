import type { ReactNode } from 'react'
import Link from 'next/link'
import { Avatar, Skeleton, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import { OPTION_CARD_CLASS, OPTION_CARD_INTERACTIVE_CLASS } from '../optionCard'

export const SERVE_CARD_SHELL_COPY = {
  unavailable: 'Could not load this. Refresh to try again.',
}

export const CardNote = ({ children }: { children: ReactNode }) => (
  <p className="text-muted-foreground text-[13px]">{children}</p>
)

// Off the first two words that carry a letter, so an office ("Dale County
// Attorney's Office") reads as DC rather than as punctuation.
export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')

export const InitialsAvatar = ({
  name,
  size = 'medium',
  className,
}: {
  name: string
  size?: 'small' | 'medium' | 'large'
  className?: string
}) => (
  <Avatar size={size} className={className} aria-hidden>
    <Avatar.Fallback>{initialsOf(name)}</Avatar.Fallback>
  </Avatar>
)

// The clarify question's option card, laid out as a row: what the card is,
// one line under it, and whatever it leads to.
const ROW_CLASS = cn(
  OPTION_CARD_CLASS,
  'flex w-full max-w-md items-center gap-3 text-left no-underline',
)

const RowContent = ({
  title,
  subtitle,
  trailing,
}: {
  title: string
  subtitle?: string
  trailing?: ReactNode
}) => (
  <>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-foreground truncate text-sm font-medium">
        {title}
      </span>
      {subtitle ? (
        <span className="text-muted-foreground truncate text-sm leading-6">
          {subtitle}
        </span>
      ) : null}
    </span>
    {trailing}
  </>
)

const Chevron = () => (
  <ChevronRightIcon
    className="text-muted-foreground size-4 shrink-0"
    aria-hidden
  />
)

/** A row that opens its detail in the panel. */
export const CompactCard = ({
  title,
  subtitle,
  expanded,
  onOpen,
}: {
  title: string
  subtitle?: string
  expanded: boolean
  onOpen: () => void
}) => (
  <button
    type="button"
    aria-haspopup="dialog"
    aria-expanded={expanded}
    onClick={onOpen}
    className={cn(
      ROW_CLASS,
      OPTION_CARD_INTERACTIVE_CLASS,
      expanded && 'border-primary bg-primary/5',
    )}
  >
    <RowContent title={title} subtitle={subtitle} trailing={<Chevron />} />
  </button>
)

/** A row that leads to a record somewhere else (a send's history). */
export const CompactCardLink = ({
  title,
  subtitle,
  href,
}: {
  title: string
  subtitle?: string
  href: string
}) => (
  <Link href={href} className={cn(ROW_CLASS, OPTION_CARD_INTERACTIVE_CLASS)}>
    <RowContent title={title} subtitle={subtitle} trailing={<Chevron />} />
  </Link>
)

/** A row whose action is its own control, or that has none. */
export const CompactCardStatic = ({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) => (
  <div className={ROW_CLASS}>
    <RowContent title={title} subtitle={subtitle} trailing={action} />
  </div>
)

export const CompactCardLoading = () => (
  <div className={ROW_CLASS} data-testid="chat-card-loading">
    <div className="flex flex-1 flex-col gap-1.5">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-48" />
    </div>
  </div>
)

export const CompactCardUnavailable = () => (
  <div className={ROW_CLASS}>
    <CardNote>{SERVE_CARD_SHELL_COPY.unavailable}</CardNote>
  </div>
)
