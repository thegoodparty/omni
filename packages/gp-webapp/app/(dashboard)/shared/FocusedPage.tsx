'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftIcon, IconButton } from '@styleguide'
import { noop } from '@shared/utils/noop'
import { NavHeaderActionSlotContext } from './DashboardNavHeaderAction'

// A page the candidate steps into from the Game Plan and back out of: no
// sidebar, a back arrow and the page's title, then one column of content.
// Your story, Your race and Your opponents share it so they read as one set.

export const FocusedPageShell = ({
  children,
}: {
  children: ReactNode
}): React.JSX.Element => (
  <main className="min-h-screen bg-sidebar">{children}</main>
)

export const FocusedPageBody = ({
  children,
}: {
  children: ReactNode
}): React.JSX.Element => (
  <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 pb-32 pt-8 sm:px-8">
    {children}
  </div>
)

interface FocusedPageHeaderProps {
  title: string
  // A quiet status on the right (Your story's Saving… / Saved).
  status?: string | null
  // Holds the right-hand slot open for a page action portalled in through
  // DashboardNavHeaderAction (Know Your Opponent's Export brief).
  actionSlotRef?: (element: HTMLElement | null) => void
  // Runs before leaving, e.g. to save what is still waiting.
  beforeLeave?: () => Promise<void>
}

// Back returns to wherever the candidate came from (usually the Game Plan),
// and to the Game Plan when the page was opened directly. From sm up, Back
// hangs in the margin left of the column, so the title lines up with the
// content below it; on a phone it sits inline.
export const FocusedPageHeader = ({
  title,
  status,
  actionSlotRef,
  beforeLeave,
}: FocusedPageHeaderProps): React.JSX.Element => {
  const router = useRouter()
  const goBack = async (): Promise<void> => {
    await beforeLeave?.()
    if (window.history.length > 1) router.back()
    else router.push('/campaign-plan')
  }
  return (
    <header className="relative mx-auto flex w-full max-w-2xl items-center gap-3 px-4 pt-6 sm:px-8 sm:pt-10">
      <IconButton
        type="button"
        variant="neutral"
        size="small"
        className="size-10 shrink-0 sm:absolute sm:-left-6"
        aria-label="Back"
        onClick={() => void goBack()}
      >
        <ArrowLeftIcon className="size-5" aria-hidden />
      </IconButton>
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      {actionSlotRef ? (
        <div ref={actionSlotRef} className="ml-auto flex items-center" />
      ) : (
        <p
          className="ml-auto text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
      )}
    </header>
  )
}

/**
 * The whole frame, for a page whose header needs nothing from its content
 * beyond an optional action. A page action rendered anywhere inside through
 * DashboardNavHeaderAction lands at the right of the title.
 */
export const FocusedPage = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}): React.JSX.Element => {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const slotValue = useMemo(() => ({ element: slot, register: noop }), [slot])
  return (
    <FocusedPageShell>
      <FocusedPageHeader title={title} actionSlotRef={setSlot} />
      <NavHeaderActionSlotContext.Provider value={slotValue}>
        <FocusedPageBody>{children}</FocusedPageBody>
      </NavHeaderActionSlotContext.Provider>
    </FocusedPageShell>
  )
}
