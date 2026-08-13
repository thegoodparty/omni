'use client'

import type { ReactNode, Ref } from 'react'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHandle,
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

// The outreach flow sheet: a full-width bottom drawer covering everything
// except the top 64px of the viewport (128px on desktop, per the design
// prototype) — drag handle, 40x40 close top-right, a 608px centered content
// column repeated in the header, body, and footer. The back affordance lives
// in the header content (OutreachFlowShell), not on the sheet chrome.
// Deliberately a COPY of the CRM's CrmSheet anatomy rather than an import:
// that sheet is Lovable-pixel-locked to the CRM and outreach will drift from
// it (WET over premature DRY — see the phase 1 implementation notes).
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
      className="h-[calc(100dvh-4rem)] w-full data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-4rem)] data-[vaul-drawer-direction=bottom]:rounded-t-[10px] lg:h-[calc(100dvh-8rem)] lg:data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-8rem)]"
      closeClassName="top-2 right-2 size-10"
    >
      <DrawerHandle />
      <DrawerHeader
        className={
          headerless
            ? 'sr-only'
            : 'shrink-0 gap-0 border-b border-border px-4 py-3 lg:px-6 lg:py-4'
        }
      >
        <div className="mx-auto w-full max-w-[608px]">{header}</div>
      </DrawerHeader>
      <DrawerBody ref={bodyRef} className="py-5 lg:px-6">
        <div className="mx-auto w-full max-w-[608px]">{children}</div>
      </DrawerBody>
      {footer && (
        <DrawerFooter className="shrink-0 border-t border-border bg-background px-4 py-3 lg:px-6">
          <div className="mx-auto flex w-full max-w-[608px] flex-col gap-2">
            {footer}
          </div>
        </DrawerFooter>
      )}
    </DrawerContent>
  </Drawer>
)
