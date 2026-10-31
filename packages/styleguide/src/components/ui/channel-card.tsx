import * as React from 'react'

import { cn } from '@styleguide/lib/utils'

interface ChannelCardProps extends React.ComponentProps<'button'> {
  icon: React.ReactNode
  label: React.ReactNode
  subCopy?: React.ReactNode
  tag?: React.ReactNode
  tagTone?: 'muted' | 'info'
  iconClassName?: string
}

/**
 * tag is the card's one label, in its top-left corner: muted for a condition
 * or a deadline (Pro, a verification cutoff), info for an offer. Every card
 * reserves the tag's room whether or not it has one, so a tag never moves the
 * icon or changes a row's height. The tag reads as the button's description,
 * not part of its name.
 *
 * @summary Use for a clickable tile that picks an outreach channel, with an
 * icon, a name and a price line. For a panel that isn't a choice, use Card.
 */
const ChannelCard = ({
  icon,
  label,
  subCopy,
  tag,
  tagTone = 'muted',
  iconClassName,
  className,
  'aria-describedby': ariaDescribedBy,
  ...props
}: ChannelCardProps) => {
  const tagId = React.useId()
  return (
    <button
      type="button"
      data-slot="channel-card"
      aria-describedby={
        [ariaDescribedBy, tag ? tagId : undefined].filter(Boolean).join(' ') ||
        undefined
      }
      className={cn(
        'bg-card text-card-foreground hover:border-primary focus-visible:border-ring focus-visible:ring-ring/50 relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border px-5 py-8 text-center transition-colors outline-none focus-visible:ring-[3px]',
        className,
      )}
      {...props}
    >
      {tag ? (
        <span
          id={tagId}
          aria-hidden="true"
          data-slot="channel-card-tag"
          data-tone={tagTone}
          className={cn(
            'absolute top-0 left-0 flex max-w-full items-center gap-1 overflow-hidden rounded-tl-xl rounded-br-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0',
            tagTone === 'info'
              ? 'bg-info text-info-contrast'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {tag}
        </span>
      ) : null}
      <span
        data-slot="channel-card-icon"
        className={cn(
          'bg-primary-light text-foreground flex size-12 shrink-0 items-center justify-center rounded-full [&_svg]:size-5',
          iconClassName,
        )}
      >
        {icon}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-foreground text-sm font-medium">{label}</span>
        {subCopy ? (
          <span className="text-muted-foreground text-xs">{subCopy}</span>
        ) : null}
      </span>
    </button>
  )
}

export { ChannelCard, type ChannelCardProps }
