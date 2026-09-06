'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode, Ref } from 'react'
import {
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
} from '@styleguide'

// Modern hairline-on-scroll affordance: the header's bottom border and the
// footer's top border appear only when there is content in the scroll
// direction they are masking. Matches iOS large-title nav, macOS Safari,
// Linear, Notion. When everything fits, the sheet reads as one clean surface.
const useScrollAffordance = () => {
  const ref = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState({
    hasContentAbove: false,
    hasContentBelow: false,
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const compute = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      setState({
        // 1px slop for sub-pixel scroll positions.
        hasContentAbove: scrollTop > 1,
        hasContentBelow: scrollTop + clientHeight < scrollHeight - 1,
      })
    }
    compute()
    el.addEventListener('scroll', compute, { passive: true })
    // Content resizes without the container resizing (a section expanding,
    // an image loading), so watch the inner column too.
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', compute)
      ro.disconnect()
    }
  }, [])

  return { ref, ...state }
}

interface OutreachSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  header: ReactNode
  // Success screens replace the header entirely (per the prototype): the
  // visible bar and border go away, but `header` still renders sr-only so
  // the drawer keeps an accessible title.
  headerless?: boolean
  // Suppress the sheet's absolute corner X. The flow shell renders its own
  // Exit control inside the header row, so the corner X would be a second
  // way to do the same thing — and its 64px mobile top-padding reserve
  // stops being needed once the corner is bare.
  hideClose?: boolean
  footer?: ReactNode
  children: ReactNode
  bodyRef?: Ref<HTMLDivElement>
}

// The outreach flow sheet: FULL SCREEN (prototype `drawerShell` full mode —
// inset 0, no rounded top, no top border, no drag handle), with a 608px
// centered content column repeated in the header, body, and footer. The
// details drawer (ListDetailsSheetShell) deliberately keeps the inset
// bottom-sheet anatomy — only flows go full screen.
export const OutreachSheet = ({
  open,
  onOpenChange,
  header,
  headerless = false,
  hideClose = false,
  footer,
  children,
  bodyRef,
}: OutreachSheetProps) => {
  const {
    ref: scrollRef,
    hasContentAbove,
    hasContentBelow,
  } = useScrollAffordance()

  // Callers pass their own ref for other reasons (measurements, focus); this
  // callback ref forwards the node to both the affordance hook and the caller.
  const mergedBodyRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      if (!bodyRef) return
      if (typeof bodyRef === 'function') bodyRef(node)
      else (bodyRef as MutableRefObject<HTMLDivElement | null>).current = node
    },
    [bodyRef, scrollRef],
  )

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
      <DrawerContent
        className="h-dvh w-full data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-dvh data-[vaul-drawer-direction=bottom]:rounded-t-none data-[vaul-drawer-direction=bottom]:border-t-0"
        closeClassName={
          hideClose
            ? 'hidden'
            : 'top-4 right-4 z-30 size-10 rounded-full lg:right-[max(1.5rem,calc((100%-608px)/2))]'
        }
        // Never dismiss on outside interactions: clicking inside the discard
        // confirm counts as "outside" this content, and Radix re-delivers that
        // pointerdown to this layer AFTER the confirm closes — un-prevented,
        // that deferred dismiss re-opened the confirm forever ("Keep editing"
        // could never close it). Close/Escape still dismiss through
        // onOpenChange, where the flow shell runs its dirty-close confirm.
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DrawerHeader
          // The flow shell renders its own Exit button inside the header
          // content — suppress DrawerHeader's built-in close so the header
          // doesn't render two.
          hideClose
          className={cn(
            headerless
              ? 'sr-only'
              : hideClose
                ? 'shrink-0 gap-0 px-6 pt-6 pb-5'
                : 'shrink-0 gap-0 px-6 pt-16 pb-5 lg:pt-6',
            !headerless && hasContentAbove && 'border-b border-border',
          )}
        >
          <div className="mx-auto w-full max-w-[608px]">{header}</div>
        </DrawerHeader>
        <DrawerBody ref={mergedBodyRef} className="px-6 py-5">
          <div className="mx-auto w-full max-w-[608px]">{children}</div>
        </DrawerBody>
        {footer && (
          <DrawerFooter
            className={cn(
              'shrink-0 bg-background px-6 py-4',
              hasContentBelow && 'border-t border-border',
            )}
          >
            <div className="mx-auto flex w-full max-w-[608px] flex-col gap-2">
              {footer}
            </div>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  )
}
