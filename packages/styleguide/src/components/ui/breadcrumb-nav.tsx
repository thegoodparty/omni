'use client'

import * as React from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { ChevronRightIcon, MoreHorizontalIcon } from './icons'
import { cn } from '@styleguide/lib/utils'

export interface BreadcrumbNavItem {
  label: string
  href?: string
}

// useLayoutEffect is suppressed during SSR. This guard keeps the server render
// and initial client render in sync (both show the full trail), then
// useLayoutEffect fires synchronously before paint to set the correct state.
const useSyncLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

function renderCrumbContent(item: BreadcrumbNavItem, isLast: boolean) {
  if (!isLast && item.href) {
    return <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
  }
  if (isLast) {
    return <BreadcrumbPage>{item.label}</BreadcrumbPage>
  }
  // Non-last with no href: plain text, not the current page
  return <span className="text-foreground font-medium">{item.label}</span>
}

export function BreadcrumbNav({
  items,
  collapsible = true,
  className,
  ...props
}: React.ComponentProps<'nav'> & {
  items: BreadcrumbNavItem[]
  collapsible?: boolean
}) {
  const navRef = useRef<HTMLElement>(null)
  const measureRef = useRef<HTMLOListElement>(null)

  // null  = show all items (no collapse)
  // n ≥ 0 = show n middle items; the rest go into the dropdown
  const [visibleMiddleCount, setVisibleMiddleCount] = useState<number | null>(
    null,
  )

  const firstItem = items[0]
  const lastItem = items[items.length - 1]
  const middleItems = items.slice(1, -1)

  const computeCollapse = useCallback(() => {
    if (!collapsible || items.length <= 2) {
      setVisibleMiddleCount(null)
      return
    }

    const nav = navRef.current
    const measureEl = measureRef.current
    if (!nav || !measureEl) return

    const containerWidth = nav.offsetWidth

    // Full trail fits — show everything
    if (measureEl.offsetWidth <= containerWidth) {
      setVisibleMiddleCount(null)
      return
    }

    // Progressive collapse: determine how many middle items fit from the left.
    const itemEls = Array.from(
      measureEl.querySelectorAll<HTMLElement>('[data-mi]'),
    )
    const sepEls = Array.from(
      measureEl.querySelectorAll<HTMLElement>('[data-ms]'),
    )

    const gap = parseFloat(getComputedStyle(measureEl).gap) || 8
    // sepW comes from the measurement element which renders the real ChevronRightIcon,
    // so this matches the visible separator width exactly.
    const sepW = sepEls[0]?.offsetWidth ?? 0
    const firstW = itemEls[0]?.offsetWidth ?? 0
    const lastW = itemEls[itemEls.length - 1]?.offsetWidth ?? 0
    const middleEls = itemEls.slice(1, -1)

    // Ellipsis button: size-4 icon (16px), no padding — load-bearing constant.
    // If padding is ever added to this button, update this value to match.
    const ellipsisW = 16

    // Minimum collapsed width: first [gap sep gap] ellipsis [gap sep gap] last
    const baseW =
      firstW + gap + sepW + gap + ellipsisW + gap + sepW + gap + lastW

    let remaining = containerWidth - baseW
    let count = 0

    for (const el of middleEls) {
      // Each additional visible middle item costs: item + gap + sep + gap
      const cost = el.offsetWidth + gap + sepW + gap
      if (remaining >= cost) {
        remaining -= cost
        count++
      } else {
        break
      }
    }

    // If every middle item fit within the ellipsis budget, the measurements are
    // inconsistent (rounding drift). Fall back to uncollapsed rather than render
    // a collapsed trail with no ellipsis, which would silently clip items.
    if (count >= middleEls.length) {
      setVisibleMiddleCount(null)
      return
    }

    setVisibleMiddleCount(count)
  }, [collapsible, items])

  // Measure synchronously before paint so the user never sees a wrapped state.
  useSyncLayoutEffect(() => {
    computeCollapse()
  }, [computeCollapse])

  // Re-check whenever the container is resized.
  useEffect(() => {
    if (!collapsible) return
    const nav = navRef.current
    if (!nav) return
    const observer = new ResizeObserver(computeCollapse)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [collapsible, computeCollapse])

  const isCollapsed = visibleMiddleCount !== null
  const visibleMiddle = isCollapsed
    ? middleItems.slice(0, visibleMiddleCount)
    : middleItems
  const hiddenMiddle = isCollapsed ? middleItems.slice(visibleMiddleCount!) : []
  const showEllipsis = hiddenMiddle.length > 0

  return (
    <nav
      ref={navRef}
      aria-label="breadcrumb"
      data-slot="breadcrumb"
      className={cn('relative', className)}
      {...props}
    >
      {/*
       * Hidden measurement list — always renders the full uncollapsed trail
       * with the real ChevronRightIcon separators so sepW matches the visible
       * list exactly, giving accurate progressive-collapse measurements.
       */}
      <ol
        ref={measureRef}
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none invisible absolute flex items-center gap-2 text-sm"
        style={{
          flexWrap: 'nowrap',
          whiteSpace: 'nowrap',
          width: 'max-content',
        }}
      >
        {items.map((item, index) => (
          <React.Fragment key={`m-${index}`}>
            {index > 0 && (
              <li data-ms="" className="[&>svg]:size-3.5">
                <ChevronRightIcon />
              </li>
            )}
            <li data-mi="" className="inline-flex items-center gap-2">
              <span>{item.label}</span>
            </li>
          </React.Fragment>
        ))}
      </ol>

      {/*
       * When collapsible, prevent flex-wrap so items never reflow to a second
       * line — they collapse instead. overflow:hidden clips any brief overflow
       * before the first measurement fires.
       */}
      <BreadcrumbList
        style={
          collapsible
            ? { flexWrap: 'nowrap', overflow: 'hidden', whiteSpace: 'nowrap' }
            : undefined
        }
      >
        {isCollapsed ? (
          <>
            {firstItem && (
              <BreadcrumbItem>
                {renderCrumbContent(firstItem, false)}
              </BreadcrumbItem>
            )}

            {visibleMiddle.map((item, i) => (
              <React.Fragment key={`v-${i}`}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {renderCrumbContent(item, false)}
                </BreadcrumbItem>
              </React.Fragment>
            ))}

            {showEllipsis && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label="Show more pages"
                        className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center transition-colors"
                      >
                        <MoreHorizontalIcon className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {hiddenMiddle.map((item, i) => (
                        <DropdownMenuItem key={`h-${i}`} asChild>
                          {item.href ? (
                            <a href={item.href}>{item.label}</a>
                          ) : (
                            <span>{item.label}</span>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </BreadcrumbItem>
              </>
            )}

            {lastItem && items.length > 1 && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {renderCrumbContent(lastItem, true)}
                </BreadcrumbItem>
              </>
            )}
          </>
        ) : (
          items.map((item, index) => {
            const isLast = index === items.length - 1
            return (
              <React.Fragment key={`${item.label}-${index}`}>
                {index > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {renderCrumbContent(item, isLast)}
                </BreadcrumbItem>
              </React.Fragment>
            )
          })
        )}
      </BreadcrumbList>
    </nav>
  )
}
