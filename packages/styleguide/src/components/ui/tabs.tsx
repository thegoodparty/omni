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
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const ref = React.useRef<HTMLDivElement>(null)

  // Radix doesn't scroll the active trigger into view; when the list overflows
  // (mobile) the active trigger can mount off-screen, so bring it into view here.
  // Leave a peek gap so the neighbouring trigger stays partially visible, signalling
  // that the list scrolls (Material scrollable-tabs affordance); scrollLeft clamps
  // to [0, max] at the ends, so no empty track is exposed past the first/last tab.
  React.useEffect(() => {
    const list = ref.current
    if (!list) return

    const PEEK = 24

    const scrollActiveIntoView = () => {
      if (list.scrollWidth <= list.clientWidth) return
      const active = list.querySelector<HTMLElement>(
        '[data-slot="tabs-trigger"][data-state="active"]',
      )
      if (!active) return
      const listRect = list.getBoundingClientRect()
      const activeRect = active.getBoundingClientRect()
      if (activeRect.left < listRect.left + PEEK) {
        list.scrollLeft -= listRect.left + PEEK - activeRect.left
      } else if (activeRect.right > listRect.right - PEEK) {
        list.scrollLeft += activeRect.right - (listRect.right - PEEK)
      }
    }

    scrollActiveIntoView()
    const observer = new MutationObserver(scrollActiveIntoView)
    observer.observe(list, {
      attributes: true,
      attributeFilter: ['data-state'],
      subtree: true,
    })
    return () => observer.disconnect()
  }, [])

  return (
    <TabsPrimitive.List
      ref={ref}
      data-slot="tabs-list"
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-10 items-center rounded-lg p-[3px]',
        // anchor to the leading edge so the first trigger stays reachable when the
        // list overflows and scrolls horizontally (mobile); justify-center would
        // push the first trigger past scrollLeft=0 and clip it permanently
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
        'text-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none',
        'data-[state=active]:bg-background data-[state=active]:border-base-border',
        'focus-visible:ring-primary-focus focus-visible:ring-[3px]',
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
