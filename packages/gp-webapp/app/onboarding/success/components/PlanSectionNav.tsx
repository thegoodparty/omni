'use client'

import { useEffect, useRef, useState } from 'react'
import {
  cn,
  FilterPill,
  FilterPillGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@styleguide'

export interface PlanSectionRef {
  id: string
  label: string
}

interface PlanSectionNavProps {
  sections: PlanSectionRef[]
  onStuckChange?: (stuck: boolean) => void
  stuckClassName?: string
  // 'pills' lays the sections out as one horizontally scrolling row of filter
  // pills that pins to the top of the screen and follows the reading position.
  variant?: 'select' | 'pills'
}

// Activate a section when its top sits in the upper half of the viewport,
// below the sticky nav.
const OBSERVER_ROOT_MARGIN = '-120px 0px -55% 0px'

// Default stuck style breaks out to the full viewport width. Callers that
// render inside a constrained layout (e.g. the dashboard sidebar shell)
// pass a contained variant instead.
const DEFAULT_STUCK_CLASSNAME =
  'sticky top-0 z-30 mx-[calc(50%-50vw)] w-screen border-b border-base-border bg-base-surface'

const PlanSectionNav = ({
  sections,
  onStuckChange,
  stuckClassName = DEFAULT_STUCK_CLASSNAME,
  variant = 'select',
}: PlanSectionNavProps): React.JSX.Element => {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '')
  const [isStuck, setIsStuck] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const pillScrollerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const onScroll = () => {
      const top = el.getBoundingClientRect().top
      setIsStuck(top <= 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    onStuckChange?.(isStuck)
  }, [isStuck, onStuckChange])

  // When sections changes (e.g. Section 2 drops out after strategy
  // resolves ready-but-empty), the previously-tracked activeId may no
  // longer be in the list. The controlled <Select value={activeId}>
  // would then have no matching <SelectItem> — Radix renders an empty
  // trigger with no label until the user clicks. Snap activeId back to
  // the first available section whenever the list shrinks past it.
  useEffect(() => {
    if (sections.length === 0) return
    if (!sections.some((s) => s.id === activeId)) {
      setActiveId(sections[0]?.id ?? '')
    }
    // Intentionally omit activeId from deps — we only want to re-check
    // when sections changes, not every time we update activeId here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections])

  useEffect(() => {
    if (sections.length === 0) return

    const elements = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null)

    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) =>
              a.target.getBoundingClientRect().top -
              b.target.getBoundingClientRect().top,
          )
        if (visible[0]) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: OBSERVER_ROOT_MARGIN, threshold: 0 },
    )

    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [sections])

  // Keep the active pill in view as the page scrolls. The row is moved by
  // hand, not with scrollIntoView, which would also scroll the page.
  useEffect(() => {
    if (variant !== 'pills') return
    const scroller = pillScrollerRef.current
    const pill = scroller?.querySelector<HTMLElement>(
      `[data-value="${CSS.escape(activeId)}"]`,
    )
    if (!scroller || !pill) return
    scroller.scrollTo({
      left: pill.offsetLeft - (scroller.clientWidth - pill.offsetWidth) / 2,
      behavior: 'smooth',
    })
  }, [activeId, variant])

  const handleChange = (value: string) => {
    setActiveId(value)
    const el = document.getElementById(value)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  if (variant === 'pills') {
    return (
      <div
        ref={wrapperRef}
        className={cn(
          'sticky top-0 z-20 -mx-6 py-3',
          isStuck && 'border-b border-border bg-background shadow-sm',
        )}
      >
        {/* Same hidden-scrollbar row as the styleguide Tabs list. */}
        <div
          ref={pillScrollerRef}
          className="relative overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <FilterPillGroup
            value={activeId}
            onValueChange={(value) => {
              // Radix single-toggle emits '' on re-pressing the active pill;
              // jump back to that section rather than clearing the selection.
              handleChange(value || activeId)
            }}
            aria-label="Jump to a section"
            className="w-max flex-nowrap"
          >
            {sections.map((s) => (
              <FilterPill
                key={s.id}
                value={s.id}
                // FilterPill has no size prop; this is its compact form.
                className="shrink-0 px-2.5 py-1 text-xs"
              >
                {s.label}
              </FilterPill>
            ))}
          </FilterPillGroup>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={wrapperRef}
      className={
        isStuck
          ? stuckClassName
          : 'sticky top-0 z-30 rounded-xl border border-base-border bg-base-surface px-3 py-2 shadow-sm'
      }
    >
      <div
        className={isStuck ? 'mx-auto w-full max-w-4xl px-4 py-2 sm:px-8' : ''}
      >
        <p className="px-1 pt-1 text-xs font-medium text-muted-foreground">
          Jump to
        </p>
        <Select value={activeId} onValueChange={handleChange}>
          <SelectTrigger className="h-10 w-full border-none px-1 shadow-none focus-visible:ring-0">
            <SelectValue placeholder="Jump to a section" />
          </SelectTrigger>
          <SelectContent>
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export default PlanSectionNav
