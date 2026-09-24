'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

type Option = { value: string; label: string; count?: number }

type Props = {
  label: string
  options: Option[]
  selected: string[]
  onChange: (next: string[]) => void
  width?: string
}

/**
 * A checkbox dropdown rather than a row of pills: state has eight underlying values
 * grouped into four, and product has four, so pills spent a whole row on filters that
 * are mostly not in use. The trigger reports the current selection so the row stays
 * readable when it is collapsed.
 */
export const MultiSelect = ({
  label,
  options,
  selected,
  onChange,
  width = 'w-[170px]',
}: Props) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const summary =
    selected.length === 0
      ? `All ${label.toLowerCase()}`
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? label)
        : `${label}: ${selected.length}`

  const toggle = (v: string) =>
    onChange(
      selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v],
    )

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex h-7 items-center justify-between gap-2 rounded-md border px-2 text-xs ${width} ${
          selected.length ? 'border-foreground' : ''
        }`}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-40 mt-1 max-h-72 w-64 overflow-auto rounded-md border bg-background p-1 shadow-md"
        >
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
            >
              Clear {label.toLowerCase()}
            </button>
          )}
          {options.map((o) => {
            const on = selected.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
              >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border">
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="flex-1 truncate">{o.label}</span>
                {o.count != null && (
                  <span className="tabular-nums text-muted-foreground">
                    {o.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
