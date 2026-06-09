'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@styleguide/lib/utils'

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

// Set (not null) only when the nearest Tooltip has openOnClick, so
// TooltipTrigger can opt into click-to-open without a prop of its own.
const TooltipOpenOnClickContext = React.createContext<{
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
} | null>(null)

function Tooltip({
  openOnClick = false,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root> & {
  /**
   * Also toggle the tooltip when the trigger is clicked/tapped (Radix only
   * opens on hover and keyboard focus, and a tap on touch devices would
   * otherwise never show the tooltip; a second tap dismisses it). Manages
   * open state internally — don't combine with `open`/`onOpenChange`.
   */
  openOnClick?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  if (!openOnClick) {
    return (
      <TooltipProvider>
        <TooltipPrimitive.Root data-slot="tooltip" {...props}>
          {children}
        </TooltipPrimitive.Root>
      </TooltipProvider>
    )
  }
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        {...props}
        open={open}
        onOpenChange={setOpen}
      >
        <TooltipOpenOnClickContext.Provider value={{ open, setOpen }}>
          {children}
        </TooltipOpenOnClickContext.Provider>
      </TooltipPrimitive.Root>
    </TooltipProvider>
  )
}

function TooltipTrigger({
  onClick,
  onPointerDown,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const openOnClick = React.useContext(TooltipOpenOnClickContext)
  // Open state captured before Radix's own pointerdown/focus handlers run.
  // A tap is one pointerdown → focus → click sequence, and on browsers that
  // focus buttons on tap Radix's focus handler opens the tooltip mid-tap; a
  // naive toggle at click time would instantly close it again. Deciding the
  // click outcome from the state at pointerdown absorbs that.
  const wasOpenAtPointerDownRef = React.useRef<boolean | null>(null)
  if (!openOnClick) {
    return (
      <TooltipPrimitive.Trigger
        data-slot="tooltip-trigger"
        onClick={onClick}
        onPointerDown={onPointerDown}
        {...props}
      />
    )
  }
  const { open, setOpen } = openOnClick
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onPointerDown={(event) => {
        onPointerDown?.(event)
        wasOpenAtPointerDownRef.current = open
      }}
      onClick={(event) => {
        onClick?.(event)
        // Radix's own click handler force-closes the tooltip; preventDefault
        // stops it so the state set below sticks.
        event.preventDefault()
        const wasOpen = wasOpenAtPointerDownRef.current
        wasOpenAtPointerDownRef.current = null
        // null means a keyboard activation (no pointerdown) — plain toggle.
        if (wasOpen === null) setOpen((prev) => !prev)
        else setOpen(!wasOpen)
      }}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  sideOffset = 0,
  showArrow = true,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  /** Hide the arrow, e.g. for card-style tooltips offset from the trigger. */
  showArrow?: boolean
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-primary text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
          className,
        )}
        {...props}
      >
        {children}
        {showArrow && (
          <TooltipPrimitive.Arrow className="bg-primary fill-primary z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
        )}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
