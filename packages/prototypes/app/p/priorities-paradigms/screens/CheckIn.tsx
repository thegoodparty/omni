'use client'

import { useState } from 'react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Separator,
  cn,
} from '@goodparty_org/styleguide'
import { Check } from 'lucide-react'
import { MAPLE, type Session } from '../data'
import { LATER_SESSIONS } from '../flow'
import { ParadigmNote } from './ParadigmNote'
import { BarVerdict, FooterBar } from './FooterBar'

type ClosedSession = Session & { resolved: string }

// The standing queue: today's live session, then the two later check-ins the
// flow scripts. Order never changes, so this is a module constant.
const QUEUE: Session[] = [MAPLE.sessions[0] as Session, ...LATER_SESSIONS]
const INITIAL_HISTORY: Session[] = MAPLE.sessions.slice(1)

export const CheckIn = () => {
  const [index, setIndex] = useState<number>(0)
  const [chosen, setChosen] = useState<string | null>(null)
  const [history, setHistory] = useState<Session[]>(INITIAL_HISTORY)

  const live = QUEUE[index]
  const total = QUEUE.length
  const position = Math.min(index + 1, total)
  const checkIns = history.length
  const decisions = history.filter((session: Session) =>
    Boolean(session.resolved),
  ).length

  const handleChoose = (label: string): void => {
    setChosen(label)
  }

  const handleCloseOut = (): void => {
    if (!live || !chosen) return
    const closed: ClosedSession = { ...live, resolved: chosen }
    setHistory((prev: Session[]) => [closed, ...prev])
    setIndex((prev: number) => prev + 1)
    setChosen(null)
  }

  const handleStartOver = (): void => {
    setIndex(0)
    setChosen(null)
    setHistory(INITIAL_HISTORY)
  }

  return (
    <div className="space-y-6 p-6 pb-40">
      <ParadigmNote
        name="Check-in"
        oneLine="A standing engagement. Each visit is a briefing and one decision."
        buys="Fits the real cadence, which is months with long waits. A parked priority becomes a feature instead of a dead end, and the agent works between visits."
        costs="The official cannot see the shape of the work, so trust rests entirely on the quality of each briefing. Demands real proactivity."
      />

      <div className="space-y-1">
        <h2 className="text-lg font-medium">{MAPLE.title}</h2>
        <p className="text-muted-foreground text-xs">
          Check-in {position} of {total}
        </p>
        <p className="text-muted-foreground text-sm">
          {MAPLE.sourceLabel} · Private · Last worked 6 days ago
        </p>
      </div>

      {live ? (
        <Card className="border-primary/30 shadow-sm">
          <CardHeader className="space-y-1">
            <p className="text-muted-foreground text-right text-xs">
              {index > 0 ? (
                <span className="text-muted-foreground">Next check-in · </span>
              ) : null}
              {live.date}
            </p>
            <CardTitle className="sr-only">Live check-in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-sm font-medium">Since you were here</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {live.changed}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium">What I did for you</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {live.didForYou}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium">What I need from you</p>

              {chosen === null ? (
                <>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {live.decision?.ask}
                  </p>
                  <div className="mt-3 space-y-2">
                    {live.decision?.options.map(
                      (option: { label: string; note: string }) => (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() => handleChoose(option.label)}
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
                      ),
                    )}
                  </div>
                </>
              ) : (
                <div className="mt-2 space-y-3">
                  <div className="flex items-center gap-2">
                    <Check className="text-success size-4" aria-hidden />
                    <p className="text-sm font-medium">Noted.</p>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    I will come back with numbers on that. Nothing else needs
                    you today.
                  </p>
                  <Button onClick={handleCloseOut}>
                    Close out this session
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-muted/40">
          <CardHeader>
            <CardTitle className="text-base">
              Nothing needs you on this one right now.
            </CardTitle>
            <CardDescription>
              I will open the next check-in when the responses land.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              {checkIns} check-ins so far. {decisions} decisions, no wizard.
            </p>
            <Button variant="ghost" size="small" onClick={handleStartOver}>
              Start over
            </Button>
          </CardContent>
        </Card>
      )}

      <Separator />

      <div className="space-y-4">
        <h3 className="text-sm font-medium">Earlier check-ins</h3>
        <div className="relative space-y-5 border-l border-border pl-5">
          {history.map((session: Session) => (
            <div key={session.id} className="relative">
              <span
                className="bg-border absolute -left-[21px] top-1.5 size-2 rounded-full"
                aria-hidden
              />
              <p className="text-sm">
                {session.date}{' '}
                <span className="text-muted-foreground">· {session.age}</span>
              </p>
              {session.changed ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  {session.changed}
                </p>
              ) : null}
              {session.didForYou ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  {session.didForYou}
                </p>
              ) : null}
              {session.resolved ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  <span className="text-foreground font-bold">
                    You decided:
                  </span>{' '}
                  {session.resolved}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <BarVerdict paradigm="check-in" />
      <FooterBar paradigm="check-in" />
    </div>
  )
}
