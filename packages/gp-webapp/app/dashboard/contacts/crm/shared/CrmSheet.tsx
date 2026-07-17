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

interface CrmSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onBack?: () => void
  header: ReactNode
  footer?: ReactNode
  children: ReactNode
  bodyRef?: Ref<HTMLDivElement>
}

// ENG-10725 (Lovable pixel parity): the shared full-width top sheet the
// create-list wizard and the list-detail view both render in — a bottom
// drawer that covers everything except the top 64px of the viewport, with a
// drag handle, a 40x40 close target top-right, an optional Back control
// pinned to the sheet's own top-left (outside the content column), a 560px
// centered left-aligned content column, and a 608px footer pinned to the
// sheet bottom.
export default function CrmSheet({
  open,
  onOpenChange,
  onBack,
  header,
  footer,
  children,
  bodyRef,
}: CrmSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
      <DrawerContent
        className="h-[calc(100dvh-4rem)] w-full data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-none data-[vaul-drawer-direction=bottom]:rounded-t-[10px]"
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
}
