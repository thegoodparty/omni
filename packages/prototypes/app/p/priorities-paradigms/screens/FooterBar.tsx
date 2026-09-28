'use client'

import { useState } from 'react'
import { IconButton, Separator, cn } from '@goodparty_org/styleguide'
import {
  AlertTriangle,
  Check,
  Clock,
  Eye,
  Mic,
  Sparkles,
  X,
} from 'lucide-react'
import { AWARENESS_LABEL, RELATIONS, type Awareness } from '../chiefOfStaff'

const GLYPH: Record<Awareness, typeof Check> = {
  none: AlertTriangle,
  reads: Eye,
  same: Check,
}

const TONE: Record<Awareness, string> = {
  none: 'text-destructive',
  reads: 'text-primary',
  same: 'text-success',
}

/**
 * A replica of the real persistent Chief of Staff bar: fixed to the bottom of
 * every dashboard route, offset by the sidebar on lg+. It is here so each shell
 * can be judged with the thing that is actually always on screen, rather than
 * in isolation.
 *
 * Tapping it opens what that shell's paradigm would do, which is the whole
 * point: on one of them it opens a second conversation over the top of the
 * first.
 */
export const FooterBar = ({
  paradigm,
}: {
  paradigm: string
}): React.JSX.Element | null => {
  const [open, setOpen] = useState(false)
  const relation = RELATIONS[paradigm]
  if (!relation) return null

  const Glyph = GLYPH[relation.awareness]
  const twoComposers = relation.composers > 1

  return (
    <>
      {open ? (
        <div className="fixed inset-x-0 bottom-0 z-40 lg:left-64">
          <div className="mx-auto w-full max-w-[608px] px-4 pb-24 lg:px-6">
            <div className="border-border bg-card rounded-xl border p-4 shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="size-4" aria-hidden />
                  What tapping the bar does here
                </span>
                <IconButton
                  size="small"
                  variant="ghost"
                  aria-label="Close"
                  onClick={() => setOpen(false)}
                >
                  <X className="size-4" aria-hidden />
                </IconButton>
              </div>
              <p className="text-muted-foreground mt-3 text-sm">
                {relation.onOpen}
              </p>
              {relation.collision ? (
                <div className="border-warning/40 bg-warning/5 mt-3 rounded-lg border p-3">
                  <p className="text-sm">{relation.collision}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="border-border bg-sidebar/95 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur lg:left-64">
        <div className="mx-auto w-full max-w-[608px] px-4 py-4 lg:px-6">
          <div className="from-destructive to-primary relative w-full rounded-full bg-gradient-to-r p-px">
            <div className="bg-card flex h-12 w-full items-center gap-1 rounded-full pl-1.5 pr-1.5">
              <IconButton
                size="small"
                variant="ghost"
                aria-label="Chat history"
                className="size-10"
                onClick={() => setOpen(!open)}
              >
                <Clock className="size-5" aria-hidden />
              </IconButton>
              <button
                type="button"
                onClick={() => setOpen(!open)}
                className="text-muted-foreground flex-1 truncate text-left text-[15px] font-medium"
              >
                Hi, Carla, how can I help?
              </button>
              <IconButton
                size="small"
                variant="ghost"
                aria-label="Dictate"
                className="size-10"
                onClick={() => setOpen(!open)}
              >
                <Mic className="size-5" aria-hidden />
              </IconButton>
              <IconButton
                size="small"
                variant="ghost"
                aria-label="Open Chief of Staff"
                className="size-10"
                onClick={() => setOpen(!open)}
              >
                <Sparkles className="size-5" aria-hidden />
              </IconButton>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <span
              className={cn(
                'flex items-center gap-1.5 text-xs',
                TONE[relation.awareness],
              )}
            >
              <Glyph className="size-3.5 shrink-0" aria-hidden />
              {AWARENESS_LABEL[relation.awareness]}
            </span>
            <span
              className={cn(
                'text-xs',
                twoComposers ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {relation.composers} composer
              {relation.composers === 1 ? '' : 's'} on screen
            </span>
            <span
              className={cn(
                'text-xs',
                relation.threads > 1
                  ? 'text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              {relation.threads} thread{relation.threads === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

/** The verdict, rendered inline at the end of a shell rather than over it. */
export const BarVerdict = ({
  paradigm,
}: {
  paradigm: string
}): React.JSX.Element | null => {
  const relation = RELATIONS[paradigm]
  if (!relation) return null
  const Glyph = GLYPH[relation.awareness]

  return (
    <div className="border-border rounded-xl border border-dashed p-4">
      <span className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4" aria-hidden />
        With the Chief of Staff bar on screen
      </span>
      <Separator className="my-3" />
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <span
          className={cn(
            'flex items-center gap-1.5 text-sm',
            TONE[relation.awareness],
          )}
        >
          <Glyph className="size-4 shrink-0" aria-hidden />
          {AWARENESS_LABEL[relation.awareness]}
        </span>
        <span className="text-muted-foreground text-sm">
          {relation.composers} composer
          {relation.composers === 1 ? '' : 's'}, {relation.threads} thread
          {relation.threads === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mt-3 text-sm">{relation.verdict}</p>
      <p className="text-muted-foreground mt-2 text-sm">
        Tap the bar below to see what it does on this shell.
      </p>
    </div>
  )
}
