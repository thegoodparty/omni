'use client'

import Link from 'next/link'
import { cn } from '@styleguide'
import type { LucideIcon } from 'lucide-react'

// The design's wide chip, measured off the prototype's computed styles rather
// than its markup: 14px/16px padding, 56px min height, --radius-md (6px), 12px
// gap, flex-start, 15px/500 container type, and only border-color transitioning
// at 150ms. Shared by the task rail and both onboarding steps so a card cannot
// look like three different things on one surface.
const CHIP = [
  'flex w-full min-h-14 items-start gap-3 rounded-md border border-border',
  'bg-card px-4 py-3.5 text-left text-[15px] font-medium',
  'transition-colors duration-150 hover:border-primary',
  'focus-visible:border-primary',
  'disabled:pointer-events-none disabled:opacity-50',
].join(' ')

// The rail hangs under the preceding message's bubble, not under its avatar.
// The design specifies 44px off a 34px avatar; the shared AssistantRow is still
// 24px + 8px gap, so this tracks what is actually rendered and moves to pl-11
// when the avatar does.
export const ASSISTANT_INDENT = 'pl-8'

const isExternalHref = (href: string): boolean =>
  /^(https?:)?\/\//.test(href) ||
  href.startsWith('mailto:') ||
  href.startsWith('tel:')

export interface WideChipProps {
  Icon: LucideIcon
  title: string
  /** The "why this matters" line. Clamped to two lines. */
  why?: string
  /** Due / impact / category line, rendered in primary. */
  impact?: string
  /** Navigates when set; otherwise `onSelect` fires. */
  href?: string
  onSelect?: () => void
  disabled?: boolean
  /** Locks the chip and marks it as the chosen answer. */
  selected?: boolean
}

export default function WideChip({
  Icon,
  title,
  why,
  impact,
  href,
  onSelect,
  disabled = false,
  selected = false,
}: WideChipProps): React.JSX.Element {
  const body = (
    <>
      <span className="mt-0.5 shrink-0 text-primary">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-[14.5px] font-semibold leading-[1.35] text-card-foreground">
          {title}
        </span>
        {/* Clamped: the design's why line is one or two lines, but an agent
            writes a full paragraph, which turns a wide chip into a wall. */}
        {why && (
          <span className="line-clamp-2 text-[13px] font-normal leading-[1.45] text-muted-foreground">
            {why}
          </span>
        )}
        {impact && (
          <span className="text-xs font-semibold tracking-[.02em] text-primary">
            {impact}
          </span>
        )}
      </span>
    </>
  )

  const className = cn(CHIP, selected && 'border-primary bg-primary/5')

  if (href) {
    return isExternalHref(href) ? (
      <a className={className} href={href} target="_blank" rel="noreferrer">
        {body}
      </a>
    ) : (
      <Link className={className} href={href}>
        {body}
      </Link>
    )
  }

  return (
    <button
      type="button"
      className={className}
      onClick={onSelect}
      disabled={disabled}
    >
      {body}
    </button>
  )
}
