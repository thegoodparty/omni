'use client'

import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from '@goodparty_org/styleguide'
import { Check, AlertCircle } from 'lucide-react'
import { MAPLE, GATE_STATE_LABEL, type Gate, type GateState } from '../data'
import { FLOW_STEPS, type StepQuestion } from '../flow'
import { ParadigmNote } from './ParadigmNote'
import { BarVerdict, FooterBar } from './FooterBar'

const findGateByLabel = (label: string, gates: Gate[]): Gate | undefined =>
  gates.find((gate: Gate) => gate.label === label)

const findDependents = (gateId: string, gates: Gate[]): string[] => {
  const gate = gates.find((candidate: Gate) => candidate.id === gateId)
  if (!gate) return []
  const direct = gates.filter(
    (candidate: Gate) => candidate.waitingOn === gate.label,
  )
  const transitive = direct.flatMap((candidate: Gate) =>
    findDependents(candidate.id, gates),
  )
  return [...direct.map((candidate: Gate) => candidate.id), ...transitive]
}

const hasUnmetAncestor = (gateId: string, gates: Gate[]): boolean => {
  const gate = gates.find((candidate: Gate) => candidate.id === gateId)
  if (!gate || !gate.waitingOn) return false
  const parent = findGateByLabel(gate.waitingOn, gates)
  if (!parent) return false
  if (parent.state !== 'met') return true
  return hasUnmetAncestor(parent.id, gates)
}

const isBlocked = (gate: Gate, gates: Gate[]): boolean => {
  if (!gate.waitingOn) return false
  const parent = findGateByLabel(gate.waitingOn, gates)
  return parent !== undefined && parent.state !== 'met'
}

// Gate ids that line up with a flow step by subject, not by matching id.
const GATE_STEP_ID: Record<string, string> = {
  problem: 'define',
  heard: 'listen_problem',
  method: 'method',
  plan: 'plan',
}

// Gates with no obvious step in the flow get a short question of their own,
// written in the same { ask, options } shape.
const INLINE_QUESTIONS: Record<string, StepQuestion> = {
  affected: {
    ask: "Whose exposure counts as the group you're solving for?",
    options: [
      {
        label: 'The 340 households inside the walk zone',
        note: 'Matches the boundary safe-routes funding is awarded against.',
      },
      {
        label: 'Just the 312 you can actually reach',
        note: 'Smaller, but it is the group outreach will actually touch.',
      },
      {
        label: 'Everyone who has complained so far',
        note: 'Easiest list to pull, but it is self-selected, not the real footprint.',
      },
    ],
  },
  authority: {
    ask: 'Who actually owns the calming standard on Maple?',
    options: [
      {
        label: 'The city, same as the street itself',
        note: 'Opens every route: study, grant, and ordinance are all in play.',
      },
      {
        label: 'The county road commission',
        note: 'Rules out the ordinance and reshapes the grant route.',
      },
      {
        label: 'Not sure, ask the attorney first',
        note: 'Cheapest real move. Everything downstream waits on this anyway.',
      },
    ],
  },
}

const FALLBACK_QUESTION: StepQuestion = {
  ask: 'What would count as this being settled?',
  options: [
    {
      label: 'Mark it settled as is',
      note: 'Move forward with what you already know.',
    },
  ],
}

const getGateQuestion = (
  gateId: string,
): { question: StepQuestion; context?: string } => {
  const stepId = GATE_STEP_ID[gateId]
  const step = stepId
    ? FLOW_STEPS.find((candidate) => candidate.id === stepId)
    : undefined
  const stepQuestion = step?.questions[0]
  if (step && stepQuestion) {
    return { question: stepQuestion, context: step.settled }
  }
  return { question: INLINE_QUESTIONS[gateId] ?? FALLBACK_QUESTION }
}

const STATE_CHIP_CLASS: Record<GateState, string> = {
  met: 'bg-success/10 text-success border-success/30',
  open: 'bg-muted text-muted-foreground border-border',
  stale: 'bg-destructive/10 text-destructive border-destructive/30',
}

const GateGlyph = ({ state }: { state: GateState }) => {
  if (state === 'met') {
    return (
      <div className="bg-success/10 flex size-6 shrink-0 items-center justify-center rounded-full">
        <Check className="text-success size-4" aria-hidden />
      </div>
    )
  }
  if (state === 'stale') {
    return (
      <div className="bg-destructive/10 flex size-6 shrink-0 items-center justify-center rounded-full">
        <AlertCircle className="text-destructive size-4" aria-hidden />
      </div>
    )
  }
  return <div className="border-border size-6 shrink-0 rounded-full border-2" />
}

export const Gates = () => {
  const [gates, setGates] = useState<Gate[]>(MAPLE.gates)
  const [workingGateId, setWorkingGateId] = useState<string | null>(null)

  const settleGate = (id: string, detail: string): void => {
    setGates((prev: Gate[]) => {
      let next: Gate[] = prev.map((gate: Gate) =>
        gate.id === id ? { ...gate, state: 'met', detail } : gate,
      )
      next = next.map((gate: Gate) =>
        gate.state === 'stale' && !hasUnmetAncestor(gate.id, next)
          ? { ...gate, state: 'open' }
          : gate,
      )
      return next
    })
    setWorkingGateId(null)
  }

  const unsettleGate = (id: string): void => {
    setGates((prev: Gate[]) => {
      const next: Gate[] = prev.map((gate: Gate) =>
        gate.id === id ? { ...gate, state: 'open' } : gate,
      )
      const dependents = findDependents(id, next)
      return next.map((gate: Gate) =>
        dependents.includes(gate.id) ? { ...gate, state: 'stale' } : gate,
      )
    })
  }

  const handleReset = (): void => {
    setGates(MAPLE.gates)
    setWorkingGateId(null)
  }

  const settledCount = gates.filter((gate: Gate) => gate.state === 'met').length
  const allMet = settledCount === gates.length
  const nextGate = gates.find(
    (gate: Gate) => gate.state !== 'met' && !isBlocked(gate, gates),
  )

  return (
    <div className="space-y-6 p-6 pb-40">
      <ParadigmNote
        name="Gates"
        oneLine="Six conditions to satisfy, in whatever order the work allows."
        buys="Directly answers the linearity problem. New information un-settles a condition instead of sending you backwards, and nothing is ever out of reach."
        costs="Risks reading as project-management software, which is not what a part-time official wants at 10pm."
      />
      <div>
        <h2 className="text-foreground text-lg font-semibold">{MAPLE.title}</h2>
        <p className="text-muted-foreground text-sm">
          {MAPLE.sourceLabel} · Private
        </p>
      </div>
      {allMet ? (
        <Card className="bg-muted/40">
          <CardHeader>
            <CardTitle className="text-base">
              Nothing is blocking this priority.
            </CardTitle>
            <CardDescription>
              Six conditions settled, in whatever order suited the work.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="ghost"
              size="small"
              className="text-muted-foreground"
              onClick={handleReset}
            >
              Reset
            </Button>
          </CardContent>
        </Card>
      ) : nextGate ? (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">{nextGate.label}</CardTitle>
            <CardDescription>{nextGate.detail}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="default"
              onClick={() => setWorkingGateId(nextGate.id)}
            >
              Work on this
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <div className="space-y-3">
        {gates.map((gate: Gate) => {
          const blocked = isBlocked(gate, gates)
          const isWorking = workingGateId === gate.id
          const { question, context } = getGateQuestion(gate.id)
          const blockerLabel = gate.waitingOn
            ? (findGateByLabel(gate.waitingOn, gates)?.label ?? gate.waitingOn)
            : null

          return (
            <div key={gate.id} className="space-y-3">
              <div className="border-border rounded-lg border p-4">
                <div className="flex items-start gap-3">
                  <GateGlyph state={gate.state} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p
                      className={cn(
                        'text-sm font-medium',
                        blocked && 'text-muted-foreground',
                      )}
                    >
                      {gate.label}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {gate.detail}
                    </p>
                    {blocked && blockerLabel ? (
                      <p className="text-muted-foreground text-sm font-semibold">
                        Not yet: {blockerLabel}
                      </p>
                    ) : gate.waitingOn ? (
                      <p className="text-muted-foreground text-sm">
                        Waiting on: {gate.waitingOn}
                      </p>
                    ) : null}
                    {gate.state === 'stale' ? (
                      <p className="text-muted-foreground text-sm">
                        Anything built on this needs another look.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Badge
                      variant="outline"
                      className={STATE_CHIP_CLASS[gate.state]}
                    >
                      {GATE_STATE_LABEL[gate.state]}
                    </Badge>
                    {gate.state === 'met' ? (
                      <Button
                        variant="ghost"
                        className="h-auto px-2 py-1 text-xs"
                        onClick={() => unsettleGate(gate.id)}
                      >
                        Un-settle
                      </Button>
                    ) : !blocked ? (
                      <Button
                        variant="ghost"
                        className="h-auto px-2 py-1 text-xs"
                        onClick={() => setWorkingGateId(gate.id)}
                      >
                        Work on it
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
              {isWorking ? (
                <Card className="border-primary/30 ml-3">
                  <CardHeader className="space-y-1">
                    <CardTitle className="text-base">{gate.label}</CardTitle>
                    {context ? (
                      <CardDescription>{context}</CardDescription>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm font-medium">{question.ask}</p>
                    <div className="space-y-2">
                      {question.options.slice(0, 3).map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() => settleGate(gate.id, option.label)}
                          className={cn(
                            'border-border w-full rounded-xl border p-3 text-left transition-colors',
                            'hover:border-primary/40 hover:bg-muted/40',
                          )}
                        >
                          <p className="text-sm font-medium">{option.label}</p>
                          <p className="text-muted-foreground mt-0.5 text-sm">
                            {option.note}
                          </p>
                        </button>
                      ))}
                    </div>
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => setWorkingGateId(null)}
                    >
                      Cancel
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {settledCount} of {gates.length} settled
        </p>
        <Button
          variant="ghost"
          size="small"
          className="text-muted-foreground"
          onClick={handleReset}
        >
          Reset
        </Button>
      </div>
      <BarVerdict paradigm="gates" />
      <FooterBar paradigm="gates" />
    </div>
  )
}
