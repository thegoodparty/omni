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
import { CAPABILITY_PROMPTS, FOLLOW_UPS, type FollowUp } from '../flow'
import { ParadigmNote } from './ParadigmNote'

const CARD_LABEL: Record<CapabilityCardKind, string> = {
  affected: 'Checked your district data',
  evidence: 'Read the speed count',
  outreach: 'Built you a list',
  constraint: 'Screened the constraints',
}

type CardLike = { label: string; title: string; lines: string[] }

type LocalTurn = {
  id: string
  role: 'user' | 'agent'
  text: string
  card?: CardLike
}

type IndexEntry = { method: string | null; nextActionLabel: string }

const seedTurns = (): LocalTurn[] =>
  CONVERSATION.map((turn: ChatTurn) => ({
    id: turn.id,
    role: turn.role,
    text: turn.text,
    card: turn.card
      ? {
          label: CARD_LABEL[turn.card.kind],
          title: turn.card.title,
          lines: turn.card.lines,
        }
      : undefined,
  }))

const seedIndex = (): Record<string, IndexEntry> =>
  Object.fromEntries(
    PRIORITIES.map((priority: Priority) => [
      priority.id,
      { method: priority.method, nextActionLabel: priority.nextAction.label },
    ]),
  )

const deriveNextAction = (fill: { id: string; body: string }): string => {
  const firstSentence = fill.body.split('.')[0]?.trim() ?? fill.body
  const words = firstSentence.split(' ')
  const short = words.slice(0, 6).join(' ')
  return words.length > 6 ? `${short}...` : short
}

const applyFills = (
  fu: FollowUp,
  prevIndex: Record<string, IndexEntry>,
): { next: Record<string, IndexEntry>; changed: boolean } => {
  const maple = prevIndex.maple
  if (!fu.fills || fu.fills.length === 0 || !maple) {
    return { next: prevIndex, changed: false }
  }
  let nextMaple: IndexEntry = { ...maple }
  for (const fill of fu.fills) {
    if (fill.id === 'method') {
      nextMaple = { ...nextMaple, method: 'Staff direction, then grant' }
    } else if (fill.id === 'plan') {
      nextMaple = {
        ...nextMaple,
        nextActionLabel: 'Ask the manager to direct the study',
      }
    } else {
      nextMaple = { ...nextMaple, nextActionLabel: deriveNextAction(fill) }
    }
  }
  return { next: { ...prevIndex, maple: nextMaple }, changed: true }
}

const CapabilityCard = ({ card }: { card: CardLike }) => (
  <div className="border-border bg-card rounded-lg border p-3">
    <p className="text-muted-foreground text-xs">{card.label}</p>
    <p className="mt-1 text-sm font-medium">{card.title}</p>
    <ul className="text-muted-foreground mt-2 list-disc space-y-0.5 pl-4 text-sm">
      {card.lines.map((line: string) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  </div>
)

const PriorityRow = ({
  priority,
  method,
  nextActionLabel,
  isChanged,
}: {
  priority: Priority
  method: string | null
  nextActionLabel: string
  isChanged: boolean
}) => (
  <div
    className={`rounded-md py-3 first:pt-0 last:pb-0 ${
      isChanged ? 'ring-1 ring-primary/40' : ''
    }`}
  >
    <p className="text-sm font-medium">{priority.short}</p>
    <p className="text-muted-foreground mt-0.5 text-xs">
      {priority.sourceLabel}
    </p>
    <p className="text-muted-foreground mt-0.5 text-xs">
      {method ?? 'No method chosen yet'}
    </p>
    <p className="text-muted-foreground mt-1 truncate text-xs">
      {nextActionLabel}
    </p>
  </div>
)

export const Capability = () => {
  const [turns, setTurns] = useState<LocalTurn[]>(seedTurns)
  const [indexState, setIndexState] =
    useState<Record<string, IndexEntry>>(seedIndex)
  const [changedId, setChangedId] = useState<string | null>(null)
  const [updateCount, setUpdateCount] = useState(0)
  const [playedPrompts, setPlayedPrompts] = useState<Set<number>>(new Set())
  const [followUpIndex, setFollowUpIndex] = useState(0)

  const handlePlay = (fu: FollowUp): void => {
    const base = turns.length
    setTurns((prev: LocalTurn[]) => [
      ...prev,
      { id: `local-${base}`, role: 'user', text: fu.user },
      { id: `local-${base + 1}`, role: 'agent', text: fu.agent, card: fu.card },
    ])
    const { next, changed } = applyFills(fu, indexState)
    setIndexState(next)
    setChangedId(changed ? 'maple' : null)
    if (changed) setUpdateCount((count: number) => count + 1)
  }

  const remainingPrompts = CAPABILITY_PROMPTS.map(
    (fu: FollowUp, i: number) => ({ fu, i }),
  ).filter(({ i }: { i: number }) => !playedPrompts.has(i))

  const nextFollowUp: FollowUp | undefined =
    remainingPrompts.length === 0 ? FOLLOW_UPS[followUpIndex] : undefined

  const handlePromptClick = (fu: FollowUp, i: number): void => {
    setPlayedPrompts((prev: Set<number>) => new Set(prev).add(i))
    handlePlay(fu)
  }

  const handleFollowUpClick = (fu: FollowUp): void => {
    setFollowUpIndex((i: number) => i + 1)
    handlePlay(fu)
  }

  const handleStartOver = (): void => {
    setTurns(seedTurns())
    setIndexState(seedIndex())
    setPlayedPrompts(new Set())
    setFollowUpIndex(0)
    setChangedId(null)
    setUpdateCount(0)
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
            {turns.map((turn: LocalTurn) =>
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
            {remainingPrompts.length > 0
              ? remainingPrompts.map(
                  ({ fu, i }: { fu: FollowUp; i: number }) => (
                    <Button
                      key={fu.user}
                      variant="outline"
                      size="small"
                      onClick={() => handlePromptClick(fu, i)}
                    >
                      {fu.user}
                    </Button>
                  ),
                )
              : nextFollowUp && (
                  <Button
                    key={nextFollowUp.user}
                    variant="outline"
                    size="small"
                    onClick={() => handleFollowUpClick(nextFollowUp)}
                  >
                    {nextFollowUp.user}
                  </Button>
                )}
          </div>

          <div>
            <Button variant="ghost" size="small" onClick={handleStartOver}>
              Start over
            </Button>
          </div>

          <div className="border-border flex items-center gap-2 rounded-lg border p-2">
            <input
              type="text"
              placeholder="Or type your own..."
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
            <p className="text-muted-foreground text-xs">
              Updated by our conversation {updateCount}{' '}
              {updateCount === 1 ? 'time' : 'times'}.
            </p>
          </CardHeader>
          <CardContent>
            <div className="divide-border divide-y">
              {PRIORITIES.map((priority: Priority) => {
                const entry = indexState[priority.id]
                return (
                  <PriorityRow
                    key={priority.id}
                    priority={priority}
                    method={entry ? entry.method : priority.method}
                    nextActionLabel={
                      entry ? entry.nextActionLabel : priority.nextAction.label
                    }
                    isChanged={changedId === priority.id}
                  />
                )
              })}
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
