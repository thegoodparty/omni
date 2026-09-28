'use client'

import { useState } from 'react'
import { Badge, Button, cn } from '@goodparty_org/styleguide'
import { ArrowRight, Eye, Clock, Check } from 'lucide-react'
import {
  PRIORITIES,
  MAPLE,
  type Priority,
  type NextAction as NextActionType,
} from '../data'
import { ParadigmNote } from './ParadigmNote'

const actionIcon = (kind: NextActionType['kind']) => {
  if (kind === 'do')
    return <ArrowRight className="text-primary size-4 shrink-0" aria-hidden />
  if (kind === 'review')
    return <Eye className="text-primary size-4 shrink-0" aria-hidden />
  return <Clock className="text-muted-foreground size-4 shrink-0" aria-hidden />
}

const actionButton = (kind: NextActionType['kind']) => {
  if (kind === 'do') return <Button size="small">Do it</Button>
  if (kind === 'review') return <Button size="small">Review</Button>
  return (
    <Button size="small" variant="ghost">
      Nudge
    </Button>
  )
}

export const NextAction = () => {
  const [openWhy, setOpenWhy] = useState<string | null>(null)
  const [showMaple, setShowMaple] = useState<boolean>(false)

  return (
    <div className="p-6 space-y-6">
      <ParadigmNote
        name="Next action"
        oneLine="Each priority shows one thing: what to do next."
        buys="Radical simplicity. Nothing to learn and nothing to abandon halfway, which suits a part-time official at 10pm."
        costs="Hides the reasoning that earns trust. Officials already distrust AI here, so the 'why' has to be one click away or this fails."
      />

      <div>
        <h2 className="text-lg font-medium">My priorities</h2>
        <p className="text-muted-foreground text-sm">
          What you are working on this term, most important first.
        </p>
      </div>

      <div className="border-border divide-border divide-y rounded-xl border">
        {PRIORITIES.map((priority: Priority, index: number) => {
          const isTop3: boolean = index < 3
          const isWhyOpen: boolean = openWhy === priority.id
          return (
            <div key={priority.id} className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                    isTop3
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{priority.title}</p>
                    <Badge variant="secondary">{priority.sourceLabel}</Badge>
                    {priority.method ? (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                      >
                        {priority.method}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {actionIcon(priority.nextAction.kind)}
                      <p
                        className={cn(
                          'truncate text-sm',
                          priority.nextAction.kind === 'waiting'
                            ? 'text-muted-foreground'
                            : 'text-foreground font-medium',
                        )}
                      >
                        {priority.nextAction.label}
                      </p>
                    </div>
                    {actionButton(priority.nextAction.kind)}
                  </div>
                </div>
              </div>

              <div className="pl-9">
                <Button
                  size="small"
                  variant="ghost"
                  className="text-muted-foreground h-auto px-2 py-1 text-xs"
                  onClick={() => setOpenWhy(isWhyOpen ? null : priority.id)}
                >
                  Why this?
                </Button>
                {isWhyOpen ? (
                  <div className="bg-muted/40 border-border mt-2 rounded-lg border p-3">
                    <p className="text-muted-foreground text-sm">
                      {priority.nextAction.why}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <div className="space-y-3">
        <Button variant="outline" onClick={() => setShowMaple(!showMaple)}>
          Show me the whole picture for Maple Ave
        </Button>
        {showMaple ? (
          <div className="border-border rounded-xl border p-4 space-y-3">
            {MAPLE.gates.map((gate) => (
              <div key={gate.id} className="flex items-start gap-3">
                {gate.state === 'met' ? (
                  <Check
                    className="text-success mt-0.5 size-4 shrink-0"
                    aria-hidden
                  />
                ) : (
                  <span
                    className="border-border mt-0.5 size-4 shrink-0 rounded-full border"
                    aria-hidden
                  />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium">{gate.label}</p>
                  <p className="text-muted-foreground text-sm">{gate.detail}</p>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <p className="text-muted-foreground text-sm">
        Three priorities. One next step each.
      </p>
    </div>
  )
}
