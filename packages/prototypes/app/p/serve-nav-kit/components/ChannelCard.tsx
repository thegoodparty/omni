'use client'

import { type LucideIcon, Lock } from 'lucide-react'
import { Card, ProBadge, cn } from '@goodparty_org/styleguide'

type ChannelCardProps = {
  label: string
  icon: LucideIcon
  locked?: boolean
  /** Icon-circle background only, matching the channel's badge colour family.
   *  The glyph colour is a single constant (below) so every icon reads the same. */
  tint?: string
  /** When set, the tile is an interactive button (keyboard-operable). */
  onClick?: () => void
}

// Composition: centered icon-in-circle selectable tile with optional Pro lock.
// styleguide's ContentCard is text-first; this is the outreach channel picker tile.
export const ChannelCard = ({
  label,
  icon: Icon,
  locked,
  tint = 'bg-primary-light',
  onClick,
}: ChannelCardProps) => (
  <Card
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onClick={onClick}
    onKeyDown={
      onClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onClick()
            }
          }
        : undefined
    }
    className={cn(
      'hover:border-primary relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl p-5 text-center transition-colors',
      locked && 'opacity-80',
    )}
  >
    {locked && (
      <div className="absolute top-3 left-3 flex items-center gap-1">
        <Lock className="text-muted-foreground size-3.5" />
      </div>
    )}
    {locked && <ProBadge size="small" className="absolute top-3 right-3" />}
    <span
      className={cn(
        'text-foreground flex size-12 items-center justify-center rounded-full',
        tint,
      )}
    >
      <Icon className="size-5" />
    </span>
    <span className="text-foreground text-sm font-medium">{label}</span>
  </Card>
)
