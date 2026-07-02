'use client'

import { useState } from 'react'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  IconButton,
  cn,
} from '@styleguide'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
} from '@styleguide/components/ui/icons'
import type { SummarySource } from '@goodparty_org/contracts'
import { hostnameFromUrl, sourceInitial } from '@shared/briefings/displaySource'

// A leading citation with no URL to open — the SWOT's "Good Party internal
// data" entry is the only caller today. Renders in the chip and carousel
// without an anchor.
export type SourceChipNonLinkedSource = {
  publisher: string
}

type SourceChipEntry = SummarySource | SourceChipNonLinkedSource

const isLinked = (entry: SourceChipEntry): entry is SummarySource =>
  'url' in entry

const letterFor = (entry: SourceChipEntry): string =>
  sourceInitial(entry.publisher)

// A raw-string fallback (unlike hostnameFromUrl's null) so a malformed URL
// still labels the chip with something identifying.
const labelFor = (entry: SourceChipEntry): string =>
  isLinked(entry) ? (hostnameFromUrl(entry.url) ?? entry.url) : entry.publisher

const entryKey = (entry: SourceChipEntry, index: number): string =>
  isLinked(entry) ? entry.url : `${entry.publisher}-${index}`

const FaviconBadge = ({
  letter,
  className,
}: {
  letter: string
  className?: string
}): React.JSX.Element => (
  <span
    aria-hidden
    className={cn(
      'inline-flex shrink-0 items-center justify-center rounded-sm bg-primary/15 font-bold text-primary',
      className,
    )}
  >
    {letter}
  </span>
)

type Props = {
  sources: SummarySource[]
  // A leading entry with no URL (e.g. the SWOT's internal-data citation).
  // Shown first in both the chip label and the carousel.
  nonLinkedSource?: SourceChipNonLinkedSource
}

// Compact citation primitive: a chip (favicon-letter + domain + "+N") that
// opens a hover-card carousel over every cited source. Opens on hover and
// keyboard focus; tap opens it only where the browser focuses buttons on tap
// (not iOS Safari) — the mobile affordance is an ENG-10635/QA follow-up. This
// is the shared primitive every redesigned brief section renders its
// "source:" row through.
const SourceChip = ({
  sources,
  nonLinkedSource,
}: Props): React.JSX.Element | null => {
  // Per-item source lists carry no uniqueness guarantee; a repeated URL from
  // the LLM would collide on the badge-strip React key and inflate "N
  // sources", so dedup once here and let count/badges/carousel all agree.
  // Mirrors the overview+background merge dedup in RaceOpponentList.
  const seen = new Set<string>()
  const uniqueSources = sources.filter((source) => {
    if (seen.has(source.url)) return false
    seen.add(source.url)
    return true
  })
  const entries: SourceChipEntry[] = nonLinkedSource
    ? [nonLinkedSource, ...uniqueSources]
    : uniqueSources
  const [currentIndex, setCurrentIndex] = useState(0)

  const first = entries[0]
  if (!first) return null
  // Falls back to the first entry if the index is ever out of range; goPrev/
  // goNext already clamp, so this only guards noUncheckedIndexedAccess.
  const current = entries[currentIndex] ?? first

  const atStart = currentIndex === 0
  const atEnd = currentIndex === entries.length - 1
  const goPrev = (): void => setCurrentIndex((i) => Math.max(0, i - 1))
  const goNext = (): void =>
    setCurrentIndex((i) => Math.min(entries.length - 1, i + 1))

  const label = labelFor(first)
  const sourceCountLabel = `${entries.length} source${entries.length === 1 ? '' : 's'}`

  return (
    <HoverCard
      openDelay={600}
      closeDelay={150}
      onOpenChange={(open) => {
        if (!open) setCurrentIndex(0)
      }}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`${sourceCountLabel}: ${label}`}
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        >
          <FaviconBadge
            letter={letterFor(first)}
            className="size-3 text-[10px]"
          />
          <span className="truncate font-mono">{label}</span>
          {entries.length > 1 && <span>+{entries.length - 1}</span>}
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="w-80 rounded-xl bg-popover p-3 shadow-md"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <IconButton
              type="button"
              variant="ghost"
              className="!h-6 !w-6 text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={atStart}
              onClick={goPrev}
              aria-label="Previous source"
            >
              <ChevronLeftIcon className="size-3.5" aria-hidden />
            </IconButton>
            <span className="text-xs tabular-nums text-muted-foreground">
              {currentIndex + 1}/{entries.length}
            </span>
            <IconButton
              type="button"
              variant="ghost"
              className="!h-6 !w-6 text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={atEnd}
              onClick={goNext}
              aria-label="Next source"
            >
              <ChevronRightIcon className="size-3.5" aria-hidden />
            </IconButton>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex -space-x-1.5">
              {entries.map((entry, index) => (
                <FaviconBadge
                  key={entryKey(entry, index)}
                  letter={letterFor(entry)}
                  className="size-4 text-[10px] ring-2 ring-popover"
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {sourceCountLabel}
            </span>
            {isLinked(current) && (
              <a
                href={current.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open source in a new tab"
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLinkIcon className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <FaviconBadge
              letter={letterFor(current)}
              className="size-4 text-[10px]"
            />
            <span className="truncate text-xs text-muted-foreground">
              {current.publisher}
            </span>
          </div>
          {isLinked(current) ? (
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-1 text-sm font-semibold text-info hover:underline"
            >
              <span>{current.title}</span>
              <ExternalLinkIcon
                className="mt-0.5 size-3 shrink-0"
                aria-hidden
              />
            </a>
          ) : (
            <span className="text-sm font-semibold text-foreground">
              {current.publisher}
            </span>
          )}
          {isLinked(current) && current.description && (
            <p className="text-xs text-muted-foreground">
              {current.description}
            </p>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

export default SourceChip
