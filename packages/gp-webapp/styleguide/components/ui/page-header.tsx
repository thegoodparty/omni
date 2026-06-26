import * as React from 'react'
import { ArrowLeftIcon } from './icons'
import { GoodPartyOrgLogo } from './good-party-org-logo'
import { Button } from './button'
import { IconButton } from './icon-button'
import { Separator } from './separator'
import { cn } from '@styleguide/lib/utils'

export interface PageHeaderProps extends React.HTMLAttributes<HTMLElement> {
  /** Main bar: section heading. */
  heading?: React.ReactNode
  /**
   * Main bar: overrides the left slot (default: GoodParty logo, hidden on desktop via lg:hidden).
   * When a custom leading is passed, breakpoint visibility and the separator are the consumer's responsibility.
   */
  leading?: React.ReactNode
  /** Main bar: mobile-only right slot — burger trigger. Hidden on desktop (lg:hidden). */
  trailing?: React.ReactNode
  /**
   * Sub-bar (optional strip below the main bar).
   * Renders automatically when onBack, backHref, subBarTrailing, or subBarContent is provided.
   */
  onBack?: () => void
  /**
   * Sub-bar: href for the back button (renders an <a> tag).
   * If both backHref and onBack are provided, backHref takes precedence and onBack is ignored.
   */
  backHref?: string
  /** Sub-bar: label shown next to the back arrow (e.g. section name). */
  backLabel?: string
  /** Sub-bar: right slot — action buttons. */
  subBarTrailing?: React.ReactNode
  /** Sub-bar: center slot content (between back button and actions). */
  subBarContent?: React.ReactNode
}

function PageHeader({
  heading,
  leading,
  trailing,
  onBack,
  backHref,
  backLabel,
  subBarTrailing,
  subBarContent,
  className,
  ...props
}: PageHeaderProps) {
  const hasSubBar = !!(onBack ?? backHref ?? subBarTrailing ?? subBarContent)

  const backEl = backHref ? (
    backLabel ? (
      <Button variant="ghost" size="small" iconPosition="left" asChild>
        <a href={backHref}>
          <ArrowLeftIcon />
          {backLabel}
        </a>
      </Button>
    ) : (
      <IconButton variant="ghost" size="small" asChild aria-label="Go back">
        <a href={backHref}>
          <ArrowLeftIcon />
        </a>
      </IconButton>
    )
  ) : onBack ? (
    backLabel ? (
      <Button
        variant="ghost"
        size="small"
        icon={<ArrowLeftIcon />}
        onClick={onBack}
      >
        {backLabel}
      </Button>
    ) : (
      <IconButton
        variant="ghost"
        size="small"
        onClick={onBack}
        aria-label="Go back"
      >
        <ArrowLeftIcon />
      </IconButton>
    )
  ) : null

  const leadingEl =
    leading !== undefined ? (
      leading
    ) : (
      <GoodPartyOrgLogo size="small" className="shrink-0 lg:hidden" />
    )

  return (
    <header
      data-slot="page-header"
      className={cn('flex flex-col w-full sticky top-0 z-10', className)}
      {...props}
    >
      <div
        data-slot="page-header-bar"
        className="flex items-center h-16 px-4 bg-sidebar border-b border-sidebar-border"
      >
        {leadingEl && (
          <>
            <div className="flex items-center shrink-0">{leadingEl}</div>
            {heading && (
              <Separator
                orientation="vertical"
                className="data-[orientation=vertical]:h-5 mx-3 lg:hidden"
              />
            )}
          </>
        )}

        {heading && (
          <div className="flex-1 min-w-0">
            <span className="block truncate text-base font-semibold text-sidebar-foreground">
              {heading}
            </span>
          </div>
        )}

        {trailing && (
          <div className="flex items-center shrink-0 ml-auto lg:hidden">
            {trailing}
          </div>
        )}
      </div>

      {hasSubBar && (
        <div
          data-slot="page-header-sub-bar"
          className="flex items-center gap-2 h-12 px-4 bg-sidebar border-b border-sidebar-border"
        >
          {backEl && <div className="flex items-center shrink-0">{backEl}</div>}

          {subBarContent && (
            <div className="flex-1 min-w-0">{subBarContent}</div>
          )}

          {subBarTrailing && (
            <div className="flex items-center gap-2 shrink-0 ml-auto">
              {subBarTrailing}
            </div>
          )}
        </div>
      )}
    </header>
  )
}

export { PageHeader }
