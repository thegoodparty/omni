'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

type Props = {
  title: string
  count?: ReactNode
  aside?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

export const Section = ({
  title,
  count,
  aside,
  defaultOpen = true,
  children,
}: Props) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1 text-sm font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`}
          />
          {title}
          {count != null && <span className="normal-case">({count})</span>}
        </button>
        {open && aside}
      </div>
      {open && children}
    </section>
  )
}
