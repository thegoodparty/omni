import { useEffect, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  ProBadge,
} from '@styleguide'

// The same phone cut ModalOrDrawer makes (under Tailwind's `md`). Read from the
// window on the first render rather than after an effect: the pitch mounts
// already open, so a default of "phone" would open a drawer on desktop and
// swap it for the dialog a frame later.
const PHONE_MAX_WIDTH = 768

const useIsPhone = (): boolean => {
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < PHONE_MAX_WIDTH,
  )
  useEffect(() => {
    const check = (): void => setIsPhone(window.innerWidth < PHONE_MAX_WIDTH)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return isPhone
}

interface GateSurfaceProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string | null
  // The pitch panel. Only this scrolls: the footer stays in view.
  children: ReactNode
  // Stacked full-width buttons, primary first.
  footer: ReactNode
}

// Where the gate stands in front of a flow (win_per_campaign_pricing): the
// flow's step stays visible behind a 640px dialog on desktop and a bottom
// drawer on a phone, the same content in both.
// Dismissed with the X only; the host's footer buttons are the only other
// way out.
export const GateSurface = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: GateSurfaceProps): React.JSX.Element => {
  const isPhone = useIsPhone()

  if (isPhone) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        {/* The sheet is the pitch, not a form, so it needs no description
            element when the host has none; undefined keeps Radix from
            warning about a missing one. */}
        <DrawerContent
          className="max-h-[92dvh]"
          {...(!description && { 'aria-describedby': undefined })}
        >
          <DrawerHandle size="sm" />
          <DrawerHeader hideClose className="pt-2 pb-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <ProBadge size="large" className="h-[30px] w-[66px]" />
              <DrawerTitle>{title}</DrawerTitle>
              {description && (
                <DrawerDescription>{description}</DrawerDescription>
              )}
            </div>
          </DrawerHeader>
          <DrawerBody>{children}</DrawerBody>
          <DrawerFooter>{footer}</DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent's own `sm:max-w-lg` would cap the 640px the design
          draws, so the width is set at the same breakpoint. */}
      <DialogContent className="flex max-h-[88vh] flex-col gap-5 rounded-2xl p-5 sm:max-w-[640px] sm:gap-6 sm:p-8">
        {/* Only the body scrolls: expanding the verification card on a short
            viewport must not carry the CTA off the bottom of the dialog. */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto sm:gap-6">
          {/* DialogHeader's own classes end in `sm:text-left`, so centering
              the wrapped lines needs the sm: breakpoint spelled out too. */}
          <DialogHeader className="items-center gap-3 text-center sm:text-center">
            <ProBadge size="large" className="h-[30px] w-[66px]" />
            <DialogTitle className="text-xl font-semibold tracking-tight sm:text-2xl">
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="text-base leading-normal">
                {description}
              </DialogDescription>
            )}
          </DialogHeader>
          {children}
        </div>
        {/* Stacked, full width: the primary, then the ghost under it. */}
        <DialogFooter className="shrink-0 flex-col items-center sm:flex-col sm:justify-center">
          {footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default GateSurface
