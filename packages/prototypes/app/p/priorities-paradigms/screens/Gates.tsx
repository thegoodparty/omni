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
import { ParadigmNote } from './ParadigmNote'

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

  const toggleGate = (id: string): void => {
    setGates((prev: Gate[]) => {
      const target = prev.find((gate: Gate) => gate.id === id)
      if (!target) return prev
      const settling = target.state !== 'met'
      let next: Gate[] = prev.map((gate: Gate) =>
        gate.id === id ? { ...gate, state: settling ? 'met' : 'open' } : gate,
      )
      if (settling) {
        next = next.map((gate: Gate) =>
          gate.state === 'stale' && !hasUnmetAncestor(gate.id, next)
            ? { ...gate, state: 'open' }
            : gate,
        )
      } else {
        const dependents = findDependents(id, next)
        next = next.map((gate: Gate) =>
          dependents.includes(gate.id) ? { ...gate, state: 'stale' } : gate,
        )
      }
      return next
    })
  }

  const settledCount = gates.filter((gate: Gate) => gate.state === 'met').length
  const nextGate = gates.find(
    (gate: Gate) =>
      gate.state !== 'met' &&
      (!gate.waitingOn ||
        findGateByLabel(gate.waitingOn, gates)?.state === 'met'),
  )

  return (
    <div className="p-6 space-y-6">
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
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="text-base">
            {nextGate ? nextGate.label : 'Nothing is blocking this'}
          </CardTitle>
          <CardDescription>
            {nextGate
              ? nextGate.detail
              : 'Every condition is settled. Nothing is waiting on you.'}
          </CardDescription>
        </CardHeader>
        {nextGate ? (
          <CardContent>
            <Button variant="default">Work on this</Button>
          </CardContent>
        ) : null}
      </Card>
      <div className="space-y-3">
        {gates.map((gate: Gate) => {
          const blocked = isBlocked(gate, gates)
          return (
            <div key={gate.id} className="border-border rounded-lg border p-4">
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
                  <p className="text-muted-foreground text-sm">{gate.detail}</p>
                  {gate.waitingOn ? (
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
                  <Button
                    variant="ghost"
                    className="h-auto px-2 py-1 text-xs"
                    onClick={() => toggleGate(gate.id)}
                  >
                    {gate.state === 'met' ? 'Un-settle' : 'Mark settled'}
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-muted-foreground text-sm">
        {settledCount} of {gates.length} settled
      </p>
    </div>
  )
}
