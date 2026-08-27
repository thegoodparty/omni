'use client'

import type { ReactNode, Ref } from 'react'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
} from '@styleguide'

interface OutreachSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  header: ReactNode
  // Success screens replace the header entirely (per the prototype): the
  // visible bar and border go away, but `header` still renders sr-only so
  // the drawer keeps an accessible title.
  headerless?: boolean
  footer?: ReactNode
  children: ReactNode
  bodyRef?: Ref<HTMLDivElement>
}

// The outreach flow sheet: FULL SCREEN (prototype `drawerShell` full mode —
// inset 0, no rounded top, no top border, no drag handle), with a 608px
// centered content column repeated in the header, body, and footer. The
// close is the sheet's own absolute corner X, top-right at the column's
// right edge on desktop; the header's mobile top padding (64px) clears it.
// The details drawer (ListDetailsSheetShell) deliberately keeps the inset
// bottom-sheet anatomy — only flows go full screen.
export const OutreachSheet = ({
  open,
  onOpenChange,
  header,
  headerless = false,
  footer,
  children,
  bodyRef,
}: OutreachSheetProps) => (
  <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
    <DrawerContent
      className="h-dvh w-full data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-dvh data-[vaul-drawer-direction=bottom]:rounded-t-none data-[vaul-drawer-direction=bottom]:border-t-0"
      closeClassName="top-4 right-4 z-30 size-10 rounded-full lg:right-[max(1.5rem,calc((100%-608px)/2))]"
      // Never dismiss on outside interactions: clicking inside the discard
      // confirm counts as "outside" this content, and Radix re-delivers that
      // pointerdown to this layer AFTER the confirm closes — un-prevented,
      // that deferred dismiss re-opened the confirm forever ("Keep editing"
      // could never close it). Close/Escape still dismiss through
      // onOpenChange, where the flow shell runs its dirty-close confirm.
      onInteractOutside={(e) => e.preventDefault()}
    >
      <DrawerHeader
        className={
          headerless
            ? 'sr-only'
            : 'shrink-0 gap-0 border-b border-border px-6 pt-16 pb-5 lg:pt-6'
        }
      >
        <div className="mx-auto w-full max-w-[608px]">{header}</div>
      </DrawerHeader>
      <DrawerBody ref={bodyRef} className="px-6 py-5">
        <div className="mx-auto w-full max-w-[608px]">{children}</div>
      </DrawerBody>
      {footer && (
        <DrawerFooter className="shrink-0 border-t border-border bg-background px-6 py-3">
          <div className="mx-auto flex w-full max-w-[608px] flex-col gap-2">
            {footer}
          </div>
        </DrawerFooter>
      )}
    </DrawerContent>
  </Drawer>
)
