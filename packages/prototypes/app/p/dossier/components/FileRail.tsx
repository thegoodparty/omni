'use client'

import { Button, cn } from '@goodparty_org/styleguide'
import { Check, ChevronRight } from 'lucide-react'
import { SECTION_STATE_LABEL, type Section } from '../data'

/**
 * The whole path, always on screen.
 *
 * The full-screen file is where you read and edit; this is where you see how
 * far along the work is without leaving the conversation. Every section is
 * listed in order, so what is still ahead is as visible as what is done, and
 * any row is a way into the file at that section.
 */
export const FileRail = ({
  sections,
  settledCount,
  onOpenSection,
  onOpenFile,
}: {
  sections: Section[]
  settledCount: number
  onOpenSection: (id: string) => void
  onOpenFile: () => void
}): React.JSX.Element => (
  <aside className="border-border bg-card flex h-fit flex-col gap-3 rounded-xl border p-4">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm font-medium">The file</span>
      <span className="text-muted-foreground text-xs tabular-nums">
        {settledCount} of {sections.length} settled
      </span>
    </div>

    <div className="bg-muted h-1 w-full overflow-hidden rounded-full">
      <div
        className="bg-primary h-full rounded-full transition-all duration-500"
        style={{ width: `${(settledCount / sections.length) * 100}%` }}
      />
    </div>

    <ol className="flex flex-col">
      {sections.map((section, i) => {
        const done = section.state === 'settled'
        const started = section.state !== 'empty'
        return (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onOpenSection(section.id)}
              className="group hover:bg-muted/60 flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors"
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] tabular-nums',
                  done
                    ? 'border-success/40 bg-success/10 text-success'
                    : started
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground',
                )}
              >
                {done ? <Check className="size-2.5" aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-sm',
                  started ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {section.label}
              </span>
              {started && !done ? (
                <span className="text-primary shrink-0 text-[11px]">
                  {SECTION_STATE_LABEL[section.state]}
                </span>
              ) : null}
              <ChevronRight
                className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </button>
          </li>
        )
      })}
    </ol>

    <Button
      variant="outline"
      size="small"
      onClick={onOpenFile}
      className="w-full"
    >
      Open the full file
    </Button>
  </aside>
)
