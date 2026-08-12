'use client'

import type { ReactNode, Ref } from 'react'
import {
  ArrowLeftIcon,
  Button,
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
  onBack?: () => void
  header: ReactNode
  footer?: ReactNode
  children: ReactNode
  bodyRef?: Ref<HTMLDivElement>
}

// The outreach flow sheet: a full-width bottom drawer covering everything
// except the top 64px of the viewport — drag handle, 40x40 close top-right,
// optional Back pinned to the sheet's own top-left, a 560px centered content
// column, and a 608px footer pinned to the sheet bottom. Deliberately a COPY
// of the CRM's CrmSheet anatomy rather than an import: that sheet is
// Lovable-pixel-locked to the CRM and outreach will drift from it (WET over
// premature DRY — see the phase 1 implementation notes).
export const OutreachSheet = ({
  open,
  onOpenChange,
  onBack,
  header,
  footer,
  children,
  bodyRef,
}: OutreachSheetProps) => (
  <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
    <DrawerContent
      className="h-[calc(100dvh-4rem)] w-full data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-4rem)] data-[vaul-drawer-direction=bottom]:rounded-t-[10px]"
      closeClassName="top-2 right-2 size-10"
    >
      <DrawerHandle />
      {onBack && (
        <Button
          type="button"
          variant="ghost"
          size="small"
          onClick={onBack}
          className="absolute top-3 left-4 gap-1 px-2"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Back
        </Button>
      )}
      <DrawerHeader className="gap-3 border-b border-border">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3">
          {header}
        </div>
      </DrawerHeader>
      <DrawerBody ref={bodyRef}>
        <div className="mx-auto w-full max-w-[560px] py-4">{children}</div>
      </DrawerBody>
      {footer && (
        <DrawerFooter>
          <div className="mx-auto flex w-full max-w-[608px] flex-col gap-2">
            {footer}
          </div>
        </DrawerFooter>
      )}
    </DrawerContent>
  </Drawer>
)
