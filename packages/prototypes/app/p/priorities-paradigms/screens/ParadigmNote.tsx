'use client'

import { useState } from 'react'
import { Button, Separator } from '@goodparty_org/styleguide'
import { ChevronDown, ChevronRight } from 'lucide-react'

type ParadigmNoteProps = {
  name: string
  oneLine: string
  buys: string
  costs: string
}

/**
 * The evaluation note that sits above each shell. Collapsed by default so the
 * screen reads as a product first and an argument second.
 */
export const ParadigmNote = ({
  name,
  oneLine,
  buys,
  costs,
}: ParadigmNoteProps) => {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-border bg-muted/40 rounded-lg border">
      <Button
        variant="ghost"
        onClick={() => setOpen(!open)}
        className="h-auto w-full justify-start gap-2 px-4 py-3 text-left font-normal"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        )}
        <span className="text-sm font-medium">{name}</span>
        <span className="text-muted-foreground hidden text-sm sm:inline">
          {oneLine}
        </span>
      </Button>
      {open ? (
        <div className="space-y-3 px-4 pb-4">
          <Separator />
          <p className="text-muted-foreground text-sm sm:hidden">{oneLine}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium">What it buys</p>
              <p className="text-muted-foreground mt-1 text-sm">{buys}</p>
            </div>
            <div>
              <p className="text-sm font-medium">What it costs</p>
              <p className="text-muted-foreground mt-1 text-sm">{costs}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
