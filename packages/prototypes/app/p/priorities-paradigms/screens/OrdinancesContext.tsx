'use client'

import { useState } from 'react'
import {
  Badge,
  Card,
  CardContent,
  ToggleGroup,
  ToggleGroupItem,
  cn,
} from '@goodparty_org/styleguide'
import { Check } from 'lucide-react'
import { ParadigmNote } from './ParadigmNote'

type Shell = 'dossier' | 'gates' | 'checkin'

type OrdinanceState = 'confirmed' | 'inProgress' | 'thin' | 'notStarted'

const CHIP_CLASS: Record<OrdinanceState, string> = {
  confirmed: 'bg-success/10 text-success border-success/30',
  inProgress: 'bg-primary/10 text-primary border-primary/30',
  thin: 'bg-warning/5 text-warning border-warning/40',
  notStarted: 'bg-muted text-muted-foreground border-border',
}

const STATE_LABEL: Record<OrdinanceState, string> = {
  confirmed: 'Confirmed',
  inProgress: 'In progress',
  thin: 'Thin',
  notStarted: 'Not started',
}

type OrdinanceSection = {
  label: string
  state: OrdinanceState
}

const SECTIONS: OrdinanceSection[] = [
  { label: 'What the ordinance changes', state: 'confirmed' },
  { label: 'Current code language', state: 'confirmed' },
  { label: 'Comparable jurisdictions', state: 'thin' },
  { label: 'Legal review', state: 'inProgress' },
  { label: 'Fiscal note', state: 'notStarted' },
  { label: 'Sponsor count', state: 'notStarted' },
  { label: 'The draft', state: 'notStarted' },
  { label: 'Reading schedule', state: 'notStarted' },
]

type Condition = {
  label: string
  settled: boolean
}

const CONDITIONS: Condition[] = [
  { label: 'You know what the code says today', settled: true },
  { label: 'You know what you want it to say', settled: true },
  { label: 'It is legal to say it', settled: false },
  { label: 'Someone will second it', settled: false },
  { label: 'It is on an agenda', settled: false },
]

export const OrdinancesContext = () => {
  const [shell, setShell] = useState<Shell>('dossier')

  return (
    <div className="p-6 space-y-6">
      <ParadigmNote
        name="Consistency check"
        oneLine="The same shells, applied to Ordinances instead."
        buys="Shows which paradigms are really one system and which are bespoke to Priorities."
        costs="Nothing. This screen is a thinking aid, not a product surface."
      />
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">
          Would this work for Ordinances too?
        </h2>
        <p className="text-muted-foreground text-sm">
          Whatever shell Priorities takes, Ordinances has to take the same one,
          or the two Serve workflows stay two products. Here is the same
          priority machinery expressed as an ordinance: drafting a canopy target
          for the tree ordinance.
        </p>
      </div>
      <ToggleGroup
        type="single"
        value={shell}
        onValueChange={(value: string) => {
          if (value) {
            setShell(value as Shell)
          }
        }}
        variant="outline"
      >
        <ToggleGroupItem value="dossier">Dossier</ToggleGroupItem>
        <ToggleGroupItem value="gates">Gates</ToggleGroupItem>
        <ToggleGroupItem value="checkin">Check-in</ToggleGroupItem>
      </ToggleGroup>
      <Card>
        <CardContent className="p-0">
          {shell === 'dossier' ? (
            <div>
              <div className="divide-border divide-y">
                {SECTIONS.map((section: OrdinanceSection) => (
                  <div
                    key={section.label}
                    className="flex items-center justify-between gap-2 px-4 py-3"
                  >
                    <span className="text-sm">{section.label}</span>
                    <Badge
                      variant="outline"
                      className={cn('text-xs', CHIP_CLASS[section.state])}
                    >
                      {STATE_LABEL[section.state]}
                    </Badge>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground px-4 py-3 text-xs">
                Same shell, different sections. This one generalises.
              </p>
            </div>
          ) : null}
          {shell === 'gates' ? (
            <div>
              <div className="divide-border divide-y">
                {CONDITIONS.map((condition: Condition) => (
                  <div
                    key={condition.label}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    {condition.settled ? (
                      <Check
                        className="text-success size-4 shrink-0"
                        aria-hidden
                      />
                    ) : (
                      <span className="border-border size-4 shrink-0 rounded-full border-2" />
                    )}
                    <span className="text-sm">{condition.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground px-4 py-3 text-xs">
                Same shell, different conditions. This one generalises.
              </p>
            </div>
          ) : null}
          {shell === 'checkin' ? (
            <div>
              <div className="space-y-4 p-4">
                <div>
                  <p className="text-sm font-medium">Since you were here</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    The attorney came back. A canopy target can be binding if it
                    is tied to permit review, not if it stands alone.
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">What I did for you</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Rewrote section 4 to hang the target off permit review, and
                    pulled the two Michigan cities that did it that way.
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">What I need from you</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Do you want the target binding at 30 percent, or
                    aspirational at 40?
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground px-4 py-3 text-xs">
                Same shell, different briefing. This one generalises, and it is
                the least work.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <div className="border-border bg-muted/40 rounded-lg border p-4">
        <p className="text-muted-foreground text-sm">
          The stepper generalises too, but it is the one that fights the work:
          an ordinance waits on an attorney and an agenda cycle the same way a
          priority waits on a council meeting. Next action generalises as a list
          page for either. Capability absorbs both and is the largest build.
        </p>
      </div>
    </div>
  )
}
