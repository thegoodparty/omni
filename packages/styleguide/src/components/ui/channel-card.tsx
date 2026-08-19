import * as React from 'react'

import { cn } from '@styleguide/lib/utils'
import { LockIcon } from './icons'

interface ChannelCardProps extends React.ComponentProps<'button'> {
  icon: React.ReactNode
  label: React.ReactNode
  subCopy?: React.ReactNode
  locked?: boolean
  iconClassName?: string
}

const ChannelCard = ({
  icon,
  label,
  subCopy,
  locked = false,
  iconClassName,
  className,
  ...props
}: ChannelCardProps) => (
  <button
    type="button"
    data-slot="channel-card"
    data-locked={locked || undefined}
    className={cn(
      'bg-card text-card-foreground hover:border-primary focus-visible:border-ring focus-visible:ring-ring/50 relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border p-5 text-center transition-colors outline-none focus-visible:ring-[3px]',
      locked && 'opacity-80',
      className,
    )}
    {...props}
  >
    {locked && (
      <LockIcon
        aria-hidden="true"
        className="text-muted-foreground absolute top-3 left-3 size-3.5"
      />
    )}
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

export { ChannelCard, type ChannelCardProps }
