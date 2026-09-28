'use client'

import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  RadioGroup,
  RadioGroupItem,
  Stepper,
} from '@goodparty_org/styleguide'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { ParadigmNote } from './ParadigmNote'
import { MAPLE } from '../data'

type HearFromOption = {
  label: string
  note: string
}

const OPTIONS: HearFromOption[] = [
  {
    label: 'Run outreach now',
    note: 'The list of 312 is built and the ask is written. You would be reviewing, not starting.',
  },
  {
    label: 'Record what I have already heard',
    note: 'Counts as real input. Tell me who you heard it from.',
  },
  {
    label: 'Do it, but not yet',
    note: 'I will hold what you wanted and raise it before the method is on the record.',
  },
  {
    label: 'Move on without it',
    note: 'Your call. Nobody in the walk zone will have been asked.',
  },
]

export const StepperToday = () => {
  const [chosen, setChosen] = useState<string | null>(null)

  return (
    <div className="p-6 space-y-6">
      <ParadigmNote
        name="Stepper (today)"
        oneLine="A linear seven-step wizard you walk front to back."
        buys="The structure is unmissable, which is exactly what officials say generic AI chat lacks."
        costs="Governing is not linear. Learning something new means going 'back', and every step must be cleared before the next one opens."
      />

      <div className="space-y-2">
        <Stepper currentStep={3} totalSteps={7} />
        <p className="text-xs font-medium uppercase tracking-widest text-primary">
          UNDERSTAND IT · WHO TO HEAR FROM
        </p>
      </div>

      <h2 className="text-lg font-semibold text-foreground">{MAPLE.title}</h2>

      <Button variant="ghost" className="gap-2 px-0">
        <ChevronLeft className="size-4" aria-hidden />
        Back to what we know
      </Button>

      <div className="rounded-lg bg-muted p-4 space-y-1">
        <p className="text-sm font-bold text-foreground">
          Let's work out who to hear from
        </p>
        <p className="text-sm text-foreground">
          Who this lands on hardest, and how you would reach them.
        </p>
      </div>

      <p className="text-sm text-foreground">
        The walk zone is four blocks north of the school. 340 households sit
        inside it and 312 have a phone. The renters on the north side are thin
        in your contact file, so the PTA reaches people you do not.
      </p>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-medium text-foreground">
            How do you want to hear from them?
          </p>
          <RadioGroup
            value={chosen ?? undefined}
            onValueChange={(value: string) => setChosen(value)}
            className="gap-3"
          >
            {OPTIONS.map((option: HearFromOption) => (
              <label
                key={option.label}
                htmlFor={option.label}
                className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-colors ${
                  chosen === option.label
                    ? 'border-primary bg-primary/5'
                    : 'border-border'
                }`}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value={option.label} id={option.label} />
                  <span className="text-sm text-foreground">
                    {option.label}
                  </span>
                </div>
                <p className="pl-7 text-xs text-muted-foreground">
                  {option.note}
                </p>
              </label>
            ))}
          </RadioGroup>
          <Button variant="outline" className="w-full">
            Or write your own...
          </Button>
        </CardContent>
      </Card>

      <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">
          Before you can continue
        </p>
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            {chosen ? (
              <Check
                className="mt-0.5 size-4 shrink-0 text-primary"
                aria-hidden
              />
            ) : (
              <Badge variant="secondary" className="mt-0.5 shrink-0">
                1
              </Badge>
            )}
            <p className="text-sm text-muted-foreground">
              Settle this step: done when you answer above
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Badge variant="secondary" className="mt-0.5 shrink-0">
              2
            </Badge>
            <p className="text-sm text-muted-foreground">
              Review the outreach I built
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Badge variant="secondary" className="mt-0.5 shrink-0">
              3
            </Badge>
            <p className="text-sm text-muted-foreground">
              Review three organizations worth calling
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The Continue button appears after all three. This repeats on each of
          the seven steps.
        </p>
        <Button variant="outline" className="w-full gap-2" disabled>
          Find who to hear from
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
