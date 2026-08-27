'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { Progress } from '@styleguide'
import { XMarkIcon } from '@styleguide/components/ui/icons'
import { noop } from '@shared/utils/noop'

// The full-screen takeover chrome the Voter Outreach 2.0 design gives the Pro
// upgrade gate and the campaign-verification flow (prototype renderPgTakeover /
// renderSgModal): a full-viewport panel with a 672px content column, an
// eyebrow + progress-bar header, an absolute corner close aligned to the
// column's right edge on desktop, and a pinned footer bar that steps fill
// through a portal slot (WizardStepFooter / TakeoverFooter consumers).

interface TakeoverFooterSlot {
  element: HTMLElement | null
  register: (delta: number) => void
}

export const TakeoverFooterSlotContext = createContext<TakeoverFooterSlot>({
  element: null,
  register: noop,
})

// True only under a TakeoverShell. Steps shared with the legacy wizard chrome
// branch their heading/footer presentation on this instead of a prop so the
// later un-fork (flipping every entry point to the takeover) touches no step.
const TakeoverActiveContext = createContext(false)

export const useTakeoverActive = (): boolean =>
  useContext(TakeoverActiveContext)

interface TakeoverShellProps {
  // Uppercase header label — "Upgrade to Pro" / "Verify campaign".
  eyebrow: string
  // 0-100; the design fills it with round(stepIndex / coreSteps * 100).
  progressValue: number
  closeHref: string
  onCloseClick?: () => void
  // Static footer content (server components use this; interactive steps use
  // the portal slot via WizardStepFooter / TextingComplianceFooter instead).
  footer?: ReactNode
  children: ReactNode
}

export const TakeoverShell = ({
  eyebrow,
  progressValue,
  closeHref,
  onCloseClick,
  footer,
  children,
}: TakeoverShellProps) => {
  const [footerElement, setFooterElement] = useState<HTMLElement | null>(null)
  const [footerCount, setFooterCount] = useState(0)

  const register = useCallback(
    (delta: number) => setFooterCount((count) => count + delta),
    [],
  )
  const slot = useMemo<TakeoverFooterSlot>(
    () => ({ element: footerElement, register }),
    [footerElement, register],
  )

  return (
    <TakeoverActiveContext.Provider value={true}>
      <TakeoverFooterSlotContext.Provider value={slot}>
        <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
          <Link
            href={closeHref}
            aria-label="Close"
            onClick={onCloseClick}
            className="absolute top-3 right-3 z-20 inline-flex size-10 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:outline-none lg:top-4 lg:right-[max(1.5rem,calc((100%-672px)/2))]"
          >
            <XMarkIcon className="size-4" />
          </Link>
          <div className="shrink-0 border-b border-border">
            <div className="mx-auto flex w-full max-w-[672px] flex-col gap-2 px-5 pt-16 pb-5 lg:px-8 lg:pt-6">
              <p className="text-xs font-bold tracking-[0.04em] text-primary uppercase">
                {eyebrow}
              </p>
              <Progress value={progressValue} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[672px] px-5 py-5 lg:px-8 lg:py-6">
              {children}
            </div>
          </div>
          <div
            className={
              footer || footerCount > 0
                ? 'shrink-0 border-t border-border bg-background'
                : 'hidden'
            }
          >
            <div
              ref={setFooterElement}
              className="mx-auto w-full max-w-[672px] px-5 py-3 lg:px-8"
            >
              {footer}
            </div>
          </div>
        </div>
      </TakeoverFooterSlotContext.Provider>
    </TakeoverActiveContext.Provider>
  )
}
