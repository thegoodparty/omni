'use client'

import { useState } from 'react'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@goodparty_org/styleguide'
import {
  CONVERSATION,
  PRIORITIES,
  type CapabilityCardKind,
  type ChatTurn,
  type Priority,
} from '../data'
import { ParadigmNote } from './ParadigmNote'

const CARD_LABEL: Record<CapabilityCardKind, string> = {
  affected: 'Checked your district data',
  evidence: 'Read the speed count',
  outreach: 'Built you a list',
  constraint: 'Screened the constraints',
}

type Chip = {
  prompt: string
  reply: string
}

const CHIPS: Chip[] = [
  {
    prompt: 'What should I do about Maple Ave?',
    reply:
      'The cheapest next step is finding out who sets the calming standard on that stretch, the county may own it instead of the city. Ask your attorney and I will price the routes that survive the answer.',
  },
  {
    prompt: 'What is my council hearing about most?',
    reply:
      'The Lincoln Park splash pad, it cleared committee Tuesday and residents are asking. Maple Ave complaints are picking up too, and the canopy ordinance is quieter but still sitting with the city attorney.',
  },
  {
    prompt: 'Draft an update on the splash pad',
    reply:
      'Already done, it has been sitting in your review queue since Tuesday, written in your voice. Want me to bring it up here so you can send it?',
  },
]

const CapabilityCard = ({ card }: { card: NonNullable<ChatTurn['card']> }) => (
  <div className="border-border bg-card rounded-lg border p-3">
    <p className="text-muted-foreground text-xs">{CARD_LABEL[card.kind]}</p>
    <p className="mt-1 text-sm font-medium">{card.title}</p>
    <ul className="text-muted-foreground mt-2 list-disc space-y-0.5 pl-4 text-sm">
      {card.lines.map((line: string) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  </div>
)

const PriorityRow = ({ priority }: { priority: Priority }) => (
  <div className="py-3 first:pt-0 last:pb-0">
    <p className="text-sm font-medium">{priority.short}</p>
    <p className="text-muted-foreground mt-0.5 text-xs">
      {priority.sourceLabel}
    </p>
    <p className="text-muted-foreground mt-0.5 text-xs">
      {priority.method ?? 'No method chosen yet'}
    </p>
    <p className="text-muted-foreground mt-1 truncate text-xs">
      {priority.nextAction.label}
    </p>
  </div>
)

export const Capability = () => {
  const [turns, setTurns] = useState<ChatTurn[]>(CONVERSATION)

  const handleChip = (chip: Chip): void => {
    const nextIndex: number = turns.length
    setTurns((prev: ChatTurn[]) => [
      ...prev,
      { id: `local-${nextIndex}`, role: 'user', text: chip.prompt },
      { id: `local-${nextIndex + 1}`, role: 'agent', text: chip.reply },
    ])
  }

  return (
    <div className="p-6 space-y-6">
      <ParadigmNote
        name="Capability"
        oneLine="One Chief of Staff conversation. Priorities is something it can do, not somewhere you go."
        buys="Fixes the real complaint, that the Chief of Staff feels isolated from everything else. One surface, many capabilities, and Ordinances becomes a capability too."
        costs="The biggest build, and it gives up the discoverability a tab provides. This is the direction, not the MVP."
      />

      <div className="space-y-1">
        <h2 className="text-lg font-medium">Chief of Staff</h2>
        <p className="text-muted-foreground text-sm">Maplewood City Council</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          <div className="space-y-4">
            {turns.map((turn: ChatTurn) =>
              turn.role === 'agent' ? (
                <div
                  key={turn.id}
                  className="bg-muted space-y-3 rounded-lg p-4"
                >
                  <p className="text-sm">{turn.text}</p>
                  {turn.card ? <CapabilityCard card={turn.card} /> : null}
                </div>
              ) : (
                <div
                  key={turn.id}
                  className="bg-primary text-primary-foreground ml-auto max-w-[85%] rounded-lg p-3"
                >
                  <p className="text-sm">{turn.text}</p>
                </div>
              ),
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {CHIPS.map((chip: Chip) => (
              <Button
                key={chip.prompt}
                variant="outline"
                size="small"
                onClick={() => handleChip(chip)}
              >
                {chip.prompt}
              </Button>
            ))}
          </div>

          <div className="border-border flex items-center gap-2 rounded-lg border p-2">
            <input
              type="text"
              placeholder="Ask me anything"
              className="placeholder:text-muted-foreground text-foreground flex-1 bg-transparent px-2 py-1.5 text-sm outline-none"
            />
            <Button size="small">Send</Button>
          </div>
        </div>

        <Card className="bg-muted/40 border-border h-fit">
          <CardHeader>
            <CardTitle className="text-base">
              What I am holding for you
            </CardTitle>
            <CardDescription>
              Maintained as we talk. Nothing to fill in here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-border divide-y">
              {PRIORITIES.map((priority: Priority) => (
                <PriorityRow key={priority.id} priority={priority} />
              ))}
            </div>
            <p className="text-muted-foreground mt-4 text-xs">
              Ask me to add, change, or drop any of these.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
