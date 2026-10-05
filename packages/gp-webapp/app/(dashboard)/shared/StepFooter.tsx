import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@styleguide'

// The element a host wants a step's buttons to land in: a footer bar below
// its scroll area. FullScreenStepChrome and OutreachSheet provide one; null
// means the step renders its footer inline.
export const StepFooterSlotContext = createContext<HTMLDivElement | null>(null)

const ALIGN = {
  between: 'sm:justify-between',
  center: 'sm:justify-center',
  start: 'sm:justify-start',
} as const

interface StepFooterProps {
  children: ReactNode
  align?: keyof typeof ALIGN
}

// Design: renderSgModal's pinned footerRow. Inside a host that provides a
// slot, the buttons portal into its footer bar below the scroll area, so
// they never scroll with the body and the body never shows through them.
// Without a slot (tests, the legacy wizard chrome) they render inline at the
// bottom of the step's column.
export const StepFooter = ({
  children,
  align = 'between',
}: StepFooterProps): React.JSX.Element => {
  const slot = useContext(StepFooterSlotContext)
  const row = cn('flex flex-col-reverse gap-3 sm:flex-row', ALIGN[align])
  if (slot) return createPortal(<div className={row}>{children}</div>, slot)
  return <div className={cn('mt-auto pt-8', row)}>{children}</div>
}
