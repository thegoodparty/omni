// No 'use client' of its own: every caller is already inside a client
// boundary, and a directive here would only cost a tick on the ratchet
// (scripts/check-use-client-count.mjs).
import { createContext, useContext, type ReactNode } from 'react'
import { useIsMobile } from '@styleguide/hooks/use-mobile'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  cn,
} from '@styleguide'

const PanelDrawerMobile = createContext(true)

interface PanelDrawerProps {
  // The desktop sheet's width, matched to the panel it opens over so the step
  // covers that panel exactly.
  sheetClassName: string
  // The phone drawer's height, matched the same way. A whole class string,
  // so Tailwind can see it.
  drawerClassName: string
  // Radix links a description when there is one and warns when there is
  // none, unless it is told the absence is deliberate.
  hasDescription: boolean
  // Swipe, overlay, close and Escape all land here.
  onDismiss: () => void
  // A save or confirm in flight is not interrupted by a stray swipe.
  busy: boolean
  children: ReactNode
}

// The steps of the door's or the call's log, opened over that panel at the
// panel's size: a styleguide Drawer below `lg` and a right Sheet above it,
// the same split both panels make. The body scrolls and the footer holds the
// step's buttons, so they stay pinned to the bottom of the viewport on a
// phone however long the step gets.
//
// One frame carries every step, and the caller swaps what is inside it. Two
// frames swapped for each other closed the second one as it opened: the
// first hands focus back to the panel behind as it unmounts, and vaul
// dismisses a modal drawer on any focus outside it, with no prop to stop it.
export const PanelDrawer = ({
  sheetClassName,
  drawerClassName,
  hasDescription,
  onDismiss,
  busy,
  children,
}: PanelDrawerProps) => {
  const isMobile = useIsMobile()
  const onOpenChange = (open: boolean) => {
    if (!open && !busy) onDismiss()
  }
  const describedBy = hasDescription ? {} : { 'aria-describedby': undefined }

  return (
    <PanelDrawerMobile.Provider value={isMobile}>
      {isMobile ? (
        <Drawer open onOpenChange={onOpenChange}>
          <DrawerContent
            className={cn('overflow-hidden', drawerClassName)}
            // DrawerContent drops its floating close only when a DrawerHeader
            // is a direct child, and here it sits inside PanelDrawerHeader, so
            // the floating one is hidden and the header's close is the one X.
            closeClassName="hidden"
            {...describedBy}
          >
            <DrawerHandle className="mt-3 h-1.5 w-[120px]" />
            {children}
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open onOpenChange={onOpenChange}>
          <SheetContent
            side="right"
            className={cn(
              'flex h-full w-full flex-col gap-0 p-0',
              sheetClassName,
            )}
            {...describedBy}
          >
            {children}
          </SheetContent>
        </Sheet>
      )}
    </PanelDrawerMobile.Provider>
  )
}

export const PanelDrawerHeader = ({
  title,
  description,
}: {
  title: string
  description?: string
}) =>
  useContext(PanelDrawerMobile) ? (
    <DrawerHeader>
      <DrawerTitle>{title}</DrawerTitle>
      {description !== undefined && (
        <DrawerDescription>{description}</DrawerDescription>
      )}
    </DrawerHeader>
  ) : (
    <SheetHeader className="pb-4">
      <SheetTitle>{title}</SheetTitle>
      {description !== undefined && (
        <SheetDescription>{description}</SheetDescription>
      )}
    </SheetHeader>
  )

export const PanelDrawerBody = ({ children }: { children: ReactNode }) =>
  useContext(PanelDrawerMobile) ? (
    <DrawerBody className="min-h-0">
      <div className="flex flex-col gap-4 pb-4">{children}</div>
    </DrawerBody>
  ) : (
    <SheetBody className="min-h-0 pb-4">{children}</SheetBody>
  )

export const PanelDrawerFooter = ({ children }: { children: ReactNode }) =>
  useContext(PanelDrawerMobile) ? (
    <DrawerFooter className="border-t border-border">{children}</DrawerFooter>
  ) : (
    <SheetFooter className="flex-col border-t border-border py-4 sm:flex-col sm:justify-start">
      {children}
    </SheetFooter>
  )
