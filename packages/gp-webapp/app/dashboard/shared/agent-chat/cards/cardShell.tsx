import type { ReactNode } from 'react'
import Link from 'next/link'
import { Avatar, Skeleton, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'

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

/**
 * The one shape every card takes in the stream: a mark, a title, one line
 * under it, a chevron. The whole card opens in the detail panel, so a thread
 * with several cards in it still reads as a conversation.
 */
const COMPACT_CARD_CLASS =
  'bg-card hover:bg-muted/50 focus-visible:ring-primary-focus flex w-full max-w-md cursor-pointer items-center gap-3 rounded-2xl border border-border p-3 text-left no-underline shadow-xs transition-colors focus-visible:ring-2 focus-visible:outline-none'

const CompactCardContent = ({
  leading,
  title,
  subtitle,
  chevron = true,
}: {
  leading: ReactNode
  title: string
  subtitle?: string
  chevron?: boolean
}) => (
  <>
    <span className="flex shrink-0 items-center">{leading}</span>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-foreground truncate text-sm font-medium">
        {title}
      </span>
      {subtitle ? (
        <span className="text-muted-foreground truncate text-xs">
          {subtitle}
        </span>
      ) : null}
    </span>
    {chevron ? (
      <ChevronRightIcon
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    ) : null}
  </>
)

export const CompactCard = ({
  leading,
  title,
  subtitle,
  expanded,
  onOpen,
}: {
  leading: ReactNode
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
      COMPACT_CARD_CLASS,
      expanded && 'bg-muted/50 border-foreground/20',
    )}
  >
    <CompactCardContent leading={leading} title={title} subtitle={subtitle} />
  </button>
)

/**
 * The same chip, for a card that hands off to the workflow that owns the job
 * (an outreach flow, a send's history) rather than opening a detail here.
 */
export const CompactCardLink = ({
  leading,
  title,
  subtitle,
  href,
  onNavigate,
}: {
  leading: ReactNode
  title: string
  subtitle?: string
  href: string
  onNavigate?: () => void
}) => (
  <Link href={href} onClick={onNavigate} className={COMPACT_CARD_CLASS}>
    <CompactCardContent leading={leading} title={title} subtitle={subtitle} />
  </Link>
)

/** The same chip with nowhere to go, for a card whose workflow is off here. */
export const CompactCardStatic = ({
  leading,
  title,
  subtitle,
}: {
  leading: ReactNode
  title: string
  subtitle?: string
}) => (
  <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-border p-3">
    <CompactCardContent
      leading={leading}
      title={title}
      subtitle={subtitle}
      chevron={false}
    />
  </div>
)

export const CompactCardLoading = () => (
  <div
    className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-border p-3"
    data-testid="chat-card-loading"
  >
    <Skeleton className="size-10 shrink-0 rounded-full" />
    <div className="flex flex-1 flex-col gap-1.5">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-48" />
    </div>
  </div>
)

export const CompactCardUnavailable = () => (
  <div className="w-full max-w-md rounded-2xl border border-border p-3">
    <CardNote>{SERVE_CARD_SHELL_COPY.unavailable}</CardNote>
  </div>
)

/** What a detail panel opens on: the card's mark, its name, one line. */
export const DetailHeader = ({
  leading,
  title,
  subtitle,
}: {
  leading: ReactNode
  title: string
  subtitle?: string
}) => (
  <div className="flex items-center gap-3">
    {leading}
    <div className="flex min-w-0 flex-col">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle ? (
        <p className="text-muted-foreground text-sm">{subtitle}</p>
      ) : null}
    </div>
  </div>
)

export const DetailSection = ({
  label,
  action,
  children,
}: {
  label: string
  action?: ReactNode
  children: ReactNode
}) => (
  <section className="flex flex-col gap-1.5">
    <div className="flex min-h-8 items-center justify-between gap-2">
      <h3 className="text-muted-foreground text-xs font-semibold">{label}</h3>
      {action}
    </div>
    {children}
  </section>
)
