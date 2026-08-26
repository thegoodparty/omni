import type { ComponentProps, ReactNode } from 'react'
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  XMarkIcon,
} from '@styleguide'

// The list details drawer's anatomy, shared by the two surfaces that open one:
// the outreach history table and the door-knocking list card. The canvas draws
// a single drawer for both, so the container, the 608px content column, the
// close's position and the header/body/footer split live here once — a drawer
// that is the same component family from both entry points is the whole
// product claim, and two copies of this markup would be two chances to drift.
//
// What each caller still owns is the BODY, because the two answer about
// different objects out of different sources: an outreach envelope read from
// `GET /v1/outreach/:id`, or a saved list whose figures come from the voter
// pack and, once knocked, a frozen route — with pending and unavailable states
// the envelope detail has no equivalent for.
interface ListDetailsSheetShellProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The accessible name. The visible heading lives in `header`, which is a
  // caller's composition (name, status, channel badge, byline), so the drawer
  // still needs a plain string of its own.
  title: string
  header: ReactNode
  children: ReactNode
  footer?: ReactNode
  // A caller whose confirm dialogs portal outside the drawer content needs
  // this to keep those clicks from dismissing the sheet mid-action.
  onInteractOutside?: ComponentProps<typeof DrawerContent>['onInteractOutside']
}

export const ListDetailsSheetShell = ({
  open,
  onOpenChange,
  title,
  header,
  children,
  footer,
  onInteractOutside,
}: ListDetailsSheetShellProps) => (
  <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
    <DrawerContent
      className="flex h-[calc(100dvh-4rem)] flex-col p-0 data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-4rem)] data-[vaul-drawer-direction=bottom]:rounded-t-[10px] lg:h-[calc(100dvh-8rem)] lg:data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-8rem)]"
      // The close lives inside the 608px content column (top right), not on
      // the sheet corner — same anatomy as the flow sheets.
      closeClassName="hidden"
      onInteractOutside={onInteractOutside}
    >
      <DrawerHandle />
      {/* asChild, so the drawer's accessible name is a span rather than the
        `h2` Radix renders by default: `header` below already carries the
        visible heading with the same words, and two headings reading "Elm St
        & 5th" is one more than the sheet has sections to head. */}
      <DrawerHeader className="sr-only">
        <DrawerTitle asChild>
          <span>{title}</span>
        </DrawerTitle>
      </DrawerHeader>
      {/* Desktop top padding clears the close button, which sits inside the
          content column rather than on the sheet corner. The hairline under
          the title block is the canvas's header divider. */}
      <div className="border-b border-border px-4 pt-6 pb-4 lg:px-6 lg:pt-14">
        <div className="mx-auto flex w-full max-w-[608px] items-start justify-between gap-2">
          {header}
          <DrawerClose className="inline-flex size-10 shrink-0 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:outline-none">
            <XMarkIcon className="size-4" />
            <span className="sr-only">Close</span>
          </DrawerClose>
        </div>
      </div>
      <DrawerBody className="flex-1 overflow-y-auto px-4 pb-6 lg:px-6">
        <div className="mx-auto w-full max-w-[608px] space-y-6">{children}</div>
      </DrawerBody>
      {footer}
    </DrawerContent>
  </Drawer>
)
