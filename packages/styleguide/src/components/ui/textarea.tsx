'use client'

import * as React from 'react'

import { cn } from '@styleguide/lib/utils'

interface TextareaProps extends React.ComponentProps<'textarea'> {
  /** Grow with the content instead of scrolling inside a fixed-height box. */
  autoGrow?: boolean
  /** With `autoGrow`, stop growing after this many rows and scroll instead. */
  maxRows?: number
}

function Textarea({
  className,
  autoGrow,
  maxRows,
  ref,
  onInput,
  ...props
}: TextareaProps) {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null)

  const assignRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )

  const resize = React.useCallback(() => {
    const el = innerRef.current
    if (!el || !autoGrow) return
    // scrollHeight never reports less than the current height, so the box has
    // to be collapsed before measuring or it could only ever grow.
    el.style.height = 'auto'
    // Unlaid-out environments (jsdom under test) report 0 and empty computed
    // styles; leave the height alone rather than collapsing the box to nothing.
    if (!el.scrollHeight) return
    const style = window.getComputedStyle(el)
    const px = (value: string, fallback = 0): number => {
      const parsed = parseFloat(value)
      return Number.isFinite(parsed) ? parsed : fallback
    }
    // Preflight sets border-box globally, so the height we assign has to cover
    // the borders that scrollHeight leaves out.
    const borderY = px(style.borderTopWidth) + px(style.borderBottomWidth)
    const natural = el.scrollHeight + borderY
    const cap = maxRows
      ? maxRows * px(style.lineHeight, 20) +
        px(style.paddingTop) +
        px(style.paddingBottom) +
        borderY
      : Number.POSITIVE_INFINITY
    el.style.height = `${Math.min(natural, cap)}px`
    el.style.overflowY = natural > cap ? 'auto' : 'hidden'
  }, [autoGrow, maxRows])

  // Covers mount and controlled updates — including a programmatic reset (the
  // composer clearing itself after a send), which fires no input event.
  React.useLayoutEffect(resize, [resize, props.value])

  return (
    <textarea
      data-slot="textarea"
      ref={assignRef}
      onInput={(event) => {
        // Uncontrolled callers have no `value` for the effect above to watch.
        resize()
        onInput?.(event)
      }}
      className={cn(
        'border-components-input-border text-foreground placeholder:text-muted-foreground focus:border-components-input-active focus-visible:ring-components-input-focus aria-invalid:border-destructive focus:aria-invalid:border-destructive focus-visible:aria-invalid:ring-destructive-focus flex w-full rounded-md border bg-components-input-base px-3 py-2 text-base transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        autoGrow ? 'min-h-0 resize-none' : 'min-h-16',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea, type TextareaProps }
