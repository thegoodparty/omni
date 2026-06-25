'use client'

import { useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@styleguide'
import {
  toDisplaySource,
  type DisplaySource,
  type SourceInput,
} from '@shared/briefings/displaySource'

const PILL_CLASS =
  'inline-flex max-w-[180px] items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground'

const SourcePill = ({ source }: { source: DisplaySource }) => {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }
  const handleEnter = () => {
    cancelClose()
    setOpen(true)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={PILL_CLASS}
        title={source.displayLabel}
        onMouseEnter={handleEnter}
        onMouseLeave={scheduleClose}
      >
        <span
          aria-hidden
          className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-[9px] font-bold text-primary"
        >
          {source.initial}
        </span>
        <span className="truncate">{source.displayLabel}</span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-80 rounded-xl p-3 text-sm"
        onMouseEnter={handleEnter}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-3 text-left">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Source</span>
            <span>1 source</span>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-[10px] font-bold text-primary"
              >
                {source.initial}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {source.publisher}
              </span>
            </div>
            {source.isProprietary ? (
              <span className="text-sm font-semibold text-foreground">
                {source.displayName}
              </span>
            ) : source.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-start gap-1 text-sm font-semibold leading-5 text-info-600 hover:underline"
              >
                <span>{source.displayName}</span>
                <ExternalLink aria-hidden className="mt-1 size-3 shrink-0" />
              </a>
            ) : (
              <span className="text-sm font-semibold text-foreground">
                {source.displayName}
              </span>
            )}
            {source.description ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {source.description}
              </p>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const SectionSourcePills = ({
  sourceIds,
  sourceById,
}: {
  sourceIds: string[]
  sourceById: Map<string, SourceInput>
}): React.JSX.Element | null => {
  const resolved = sourceIds
    .map((id) => sourceById.get(id))
    .filter((s): s is SourceInput => Boolean(s))
    .map(toDisplaySource)
  if (resolved.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="italic text-muted-foreground">source:</span>
      {resolved.map((s) => (
        <SourcePill key={s.id} source={s} />
      ))}
    </div>
  )
}

export default SectionSourcePills
