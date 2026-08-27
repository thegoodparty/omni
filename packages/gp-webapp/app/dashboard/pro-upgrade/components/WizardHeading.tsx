'use client'

import type { ReactNode } from 'react'
import { ProBadge } from '@styleguide'
import { LockIcon } from '@styleguide/components/ui/icons'
import Body2 from '@shared/typography/Body2'
import { useTakeoverActive } from 'app/dashboard/shared/takeover/TakeoverShell'

interface WizardHeadingProps {
  title: string
  subtitle?: ReactNode
  // Design sgProHeader: ProBadge + lock circle above the intro on upgrade
  // steps. Rendered only under the takeover chrome.
  proBadge?: boolean
  center?: boolean
}

// One heading, two presentations (same split as WizardStepFooter): the legacy
// wizard chrome keeps the 32px h1 + Body2 every step carried inline; the
// takeover chrome uses the design's intro anatomy — optional ProBadge + lock
// row, 20px/600 title, 16px muted subtitle.
const WizardHeading = ({
  title,
  subtitle,
  proBadge = false,
  center = false,
}: WizardHeadingProps) => {
  const takeover = useTakeoverActive()

  if (takeover) {
    return (
      <>
        {proBadge && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <ProBadge size="large" />
            <span
              aria-label="Locked"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-light text-muted-foreground"
            >
              <LockIcon className="size-3.5" />
            </span>
          </div>
        )}
        <div
          className={`mb-6 flex flex-col gap-2 ${center ? 'text-center' : ''}`}
        >
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && (
            <p className="text-base text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <h1
        className={`text-[32px] leading-[44px] font-semibold ${
          subtitle ? 'mb-1.5' : 'mb-6'
        } ${center ? 'text-center' : ''}`}
      >
        {title}
      </h1>
      {subtitle && (
        <Body2
          className={`mb-6 text-base-muted-foreground ${center ? 'text-center' : ''}`}
        >
          {subtitle}
        </Body2>
      )}
    </>
  )
}

export default WizardHeading
