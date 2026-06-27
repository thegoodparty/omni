'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'

import { cn } from '@styleguide/lib/utils'

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const listRef = React.useRef<HTMLDivElement>(null)

  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref)
        (ref as React.RefObject<HTMLDivElement | null>).current = node
    },
    [ref],
  )

  // Radix doesn't scroll the active trigger into view; when the list overflows
  // (mobile) the active trigger can mount or be selected off-screen, so bring it
  // into view here. Leave a peek gap so the neighbouring trigger stays partially
  // visible, signalling that the list scrolls (Material scrollable-tabs affordance);
  // scrollLeft clamps to [0, max] at the ends, so no empty track is exposed.
  React.useEffect(() => {
    const list = listRef.current
    if (!list) return

    const PEEK = 24

    const scrollActiveIntoView = (behavior: ScrollBehavior) => {
      if (list.scrollWidth <= list.clientWidth) return
      const active = list.querySelector<HTMLElement>(
        '[data-slot="tabs-trigger"][data-state="active"]',
      )
      if (!active) return
      const listRect = list.getBoundingClientRect()
      const activeRect = active.getBoundingClientRect()
      let delta = 0
      if (activeRect.left < listRect.left + PEEK) {
        delta = activeRect.left - (listRect.left + PEEK)
      } else if (activeRect.right > listRect.right - PEEK) {
        delta = activeRect.right - (listRect.right - PEEK)
      }
      if (delta !== 0) list.scrollBy({ left: delta, behavior })
    }

    const prefersReducedMotion = () =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // instant on mount; animate on later selection unless the user opts out
    scrollActiveIntoView('auto')

    const mutationObserver = new MutationObserver(() =>
      scrollActiveIntoView(prefersReducedMotion() ? 'auto' : 'smooth'),
    )
    mutationObserver.observe(list, {
      attributes: true,
      attributeFilter: ['data-state'],
      subtree: true,
    })

    // re-anchor the active trigger when the available width changes (rotate/resize)
    const resizeObserver = new ResizeObserver(() =>
      scrollActiveIntoView('auto'),
    )
    resizeObserver.observe(list)

    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <TabsPrimitive.List
      ref={setRef}
      data-slot="tabs-list"
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-10 items-center rounded-lg p-[3px]',
        // anchor to the leading edge so the first trigger stays reachable when the
        // list overflows; justify-center would push it past scrollLeft=0 and clip it
        'w-fit max-w-full justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'text-foreground inline-flex h-[calc(100%-1px)] grow shrink-0 items-center justify-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow] outline-none',
        'data-[state=inactive]:hover:bg-background/50',
        'data-[state=active]:bg-background data-[state=active]:border-base-border',
        'focus-visible:ring-primary-focus focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
