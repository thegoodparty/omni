'use client'

import { useState } from 'react'
import { Button, Separator, cn } from '@goodparty_org/styleguide'
import { AlertCircle, Check, Eye, HelpCircle, Sparkles } from 'lucide-react'
import {
  CONTINUITY_LABEL,
  RELATIONS,
  THE_QUESTION,
  type Continuity,
} from '../chiefOfStaff'

const GLYPH: Record<Continuity, typeof Check> = {
  'same-thread': AlertCircle,
  reads: Eye,
  contested: HelpCircle,
  'is-the-surface': Check,
}

const TONE: Record<Continuity, string> = {
  'same-thread': 'text-destructive',
  reads: 'text-primary',
  contested: 'text-warning',
  'is-the-surface': 'text-success',
}

/**
 * The same question put to Chief of Staff, on every shell. Deliberately drawn
 * as a separate surface (its own frame and label) except on the capability
 * shell, where the point is that there is no second surface to draw.
 */
export const ChiefOfStaffPanel = ({
  paradigm,
}: {
  paradigm: string
}): React.JSX.Element | null => {
  const [open, setOpen] = useState(true)
  const relation = RELATIONS[paradigm]
  if (!relation) return null

  const Glyph = GLYPH[relation.continuity]
  const sameSurface = relation.continuity === 'is-the-surface'

  return (
    <div className="border-border rounded-xl border border-dashed">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4">
        <span className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4" aria-hidden />
          {sameSurface ? 'Asked in this same chat' : 'Over in Chief of Staff'}
        </span>
        <span
          className={cn(
            'flex items-center gap-1.5 text-sm',
            TONE[relation.continuity],
          )}
        >
          <Glyph className="size-4 shrink-0" aria-hidden />
          {CONTINUITY_LABEL[relation.continuity]}
        </span>
        <Button
          variant="ghost"
          size="small"
          onClick={() => setOpen(!open)}
          className="text-muted-foreground ml-auto font-normal"
        >
          {open ? 'Hide' : 'Show'}
        </Button>
      </div>

      {open ? (
        <div className="space-y-4 p-4">
          <div className="space-y-3">
            <div className="ml-auto max-w-[85%] rounded-lg bg-primary p-3 text-primary-foreground">
              <p className="text-sm">{THE_QUESTION}</p>
            </div>
            <div className="rounded-lg bg-muted p-4">
              <p className="text-sm">{relation.answer}</p>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium">What it can see</p>
              <ul className="mt-2 space-y-1">
                {relation.knows.map((line: string) => (
                  <li
                    key={line}
                    className="text-muted-foreground flex gap-2 text-sm"
                  >
                    <Check
                      className="text-success mt-0.5 size-3.5 shrink-0"
                      aria-hidden
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-medium">What it cannot</p>
              <ul className="mt-2 space-y-1">
                {relation.blind.map((line: string) => (
                  <li
                    key={line}
                    className="text-muted-foreground flex gap-2 text-sm"
                  >
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-border bg-muted/40 rounded-lg border p-3">
            <p className="text-sm">{relation.verdict}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
