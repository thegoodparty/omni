'use client'

import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Separator,
  cn,
} from '@goodparty_org/styleguide'
import { Send } from 'lucide-react'
import {
  MAPLE,
  CONVERSATION,
  SECTION_STATE_LABEL,
  type DossierSection,
  type SectionState,
} from '../data'
import { FOLLOW_UPS } from '../flow'
import { ParadigmNote } from './ParadigmNote'
import { BarVerdict, FooterBar } from './FooterBar'

const CHIP_CLASS: Record<SectionState, string> = {
  confirmed: 'bg-success/10 text-success border-success/30',
  draft: 'bg-primary/10 text-primary border-primary/30',
  thin: 'bg-warning/5 text-warning border-warning/40',
  empty: 'bg-muted text-muted-foreground border-border',
  stale: 'bg-destructive/10 text-destructive border-destructive/30',
}

export const Dossier = () => {
  const [sections, setSections] = useState<DossierSection[]>(MAPLE.sections)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flagged, setFlagged] = useState<boolean>(false)
  const [preFlagSections, setPreFlagSections] = useState<
    DossierSection[] | null
  >(null)
  const [playedCount, setPlayedCount] = useState<number>(0)
  const [justFilledIds, setJustFilledIds] = useState<string[]>([])

  const settledCount = sections.filter(
    (section: DossierSection) => section.state === 'confirmed',
  ).length

  const selected = sections.find(
    (section: DossierSection) => section.id === selectedId,
  )

  const playedFollowUps = FOLLOW_UPS.slice(0, playedCount)
  const nextFollowUp = FOLLOW_UPS[playedCount]

  const clearRing = () => {
    if (justFilledIds.length > 0) {
      setJustFilledIds([])
    }
  }

  const selectSection = (id: string | null) => {
    clearRing()
    setSelectedId(id)
  }

  const toggleFlag = () => {
    clearRing()
    if (flagged) {
      if (preFlagSections) {
        setSections(preFlagSections)
      }
      setPreFlagSections(null)
      setFlagged(false)
      return
    }
    setPreFlagSections(sections)
    const problem = sections.find(
      (section: DossierSection) => section.id === 'problem',
    )
    const dependents = problem?.dependents ?? []
    setSections(
      sections.map((section: DossierSection) => {
        if (section.id === 'problem') {
          return { ...section, state: 'draft' as SectionState }
        }
        if (dependents.includes(section.id)) {
          return { ...section, state: 'stale' as SectionState }
        }
        return section
      }),
    )
    setFlagged(true)
  }

  const playFollowUp = () => {
    if (!nextFollowUp) {
      return
    }
    const fills = nextFollowUp.fills ?? []
    if (fills.length > 0) {
      setSections((prev) =>
        prev.map((section: DossierSection) => {
          const fill = fills.find(
            (candidate: { id: string; body: string }) =>
              candidate.id === section.id,
          )
          return fill
            ? {
                ...section,
                body: fill.body,
                state: 'confirmed' as SectionState,
              }
            : section
        }),
      )
      setJustFilledIds(fills.map((fill: { id: string }) => fill.id))
    } else {
      setJustFilledIds([])
    }
    setPlayedCount((count) => count + 1)
  }

  return (
    <div className="space-y-6 p-6 pb-40">
      <ParadigmNote
        name="Dossier"
        oneLine="A conversation on the left, a living case file on the right."
        buys="Non-linearity for free. Revisiting the problem is editing a section, and the agent marks what downstream of it went stale. The word 'back' disappears."
        costs="Needs a section schema per workflow, plus real state for confirmed versus stale."
      />
      <div>
        <h2 className="text-xl font-semibold">{MAPLE.title}</h2>
        <p className="text-muted-foreground text-sm">
          {`${MAPLE.sourceLabel} · Private`}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {CONVERSATION.map((turn) =>
            turn.role === 'agent' ? (
              <div key={turn.id} className="space-y-2">
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-sm">{turn.text}</p>
                </div>
                {turn.card ? (
                  <div className="border-border bg-card rounded-lg border p-3">
                    <p className="text-sm font-medium">{turn.card.title}</p>
                    <ul className="mt-2 space-y-1">
                      {turn.card.lines.map((line: string, index: number) => (
                        <li
                          key={index}
                          className="text-muted-foreground flex gap-2 text-sm"
                        >
                          <span aria-hidden>&bull;</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                key={turn.id}
                className="ml-auto max-w-[85%] rounded-lg bg-primary p-3 text-primary-foreground"
              >
                <p className="text-sm">{turn.text}</p>
              </div>
            ),
          )}
          {playedFollowUps.map((followUp, index) => (
            <div key={`follow-up-${index}`} className="space-y-2">
              <div className="ml-auto max-w-[85%] rounded-lg bg-primary p-3 text-primary-foreground">
                <p className="text-sm">{followUp.user}</p>
              </div>
              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm">{followUp.agent}</p>
              </div>
              {followUp.card ? (
                <div className="border-border bg-card rounded-lg border p-3">
                  <p className="text-muted-foreground text-xs">
                    {followUp.card.label}
                  </p>
                  <p className="text-sm font-medium">{followUp.card.title}</p>
                  <ul className="mt-2 space-y-1">
                    {followUp.card.lines.map(
                      (line: string, lineIndex: number) => (
                        <li
                          key={lineIndex}
                          className="text-muted-foreground flex gap-2 text-sm"
                        >
                          <span aria-hidden>&bull;</span>
                          <span>{line}</span>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ) : null}
            </div>
          ))}
          {nextFollowUp ? (
            <Button
              variant="outline"
              onClick={playFollowUp}
              className="h-auto w-full whitespace-normal py-2 text-left"
            >
              {nextFollowUp.user}
            </Button>
          ) : (
            <p className="text-muted-foreground text-sm">
              That is the file filled in. Press &apos;Something changed about
              the problem&apos; to see what happens when one answer moves.
            </p>
          )}
          <div className="border-border flex items-center gap-2 rounded-lg border p-3">
            <span className="text-muted-foreground flex-1 text-sm">
              Or type your own...
            </span>
            <Button size="small">
              <Send className="size-4" aria-hidden />
              Send
            </Button>
          </div>
        </div>
        <div className="space-y-3">
          <Button
            variant="outline"
            onClick={toggleFlag}
            className="h-auto w-full whitespace-normal py-2 text-center"
          >
            {flagged ? 'Undo' : 'Something changed about the problem'}
          </Button>
          {flagged ? (
            <p className="text-muted-foreground text-sm">
              Three sections were built on the old problem statement. I have
              flagged them.
            </p>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Case file</CardTitle>
              <CardDescription>
                What we know so far, and what still needs work.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {selected ? (
                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{selected.label}</p>
                    <Badge
                      variant="outline"
                      className={cn('text-xs', CHIP_CLASS[selected.state])}
                    >
                      {SECTION_STATE_LABEL[selected.state]}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {selected.body || 'Nothing here yet.'}
                  </p>
                  {selected.caveat ? (
                    <div className="border-warning/40 bg-warning/5 rounded-lg border p-3">
                      <p className="text-sm">
                        <span className="font-bold">
                          {selected.state === 'thin'
                            ? 'Still thin: '
                            : 'Worth knowing: '}
                        </span>
                        {selected.caveat}
                      </p>
                    </div>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => selectSection(null)}
                  >
                    Back to list
                  </Button>
                </div>
              ) : (
                <div className="divide-border divide-y">
                  {sections.map((section: DossierSection) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => selectSection(section.id)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40',
                        justFilledIds.includes(section.id) &&
                          'ring-1 ring-primary/40',
                      )}
                    >
                      <span
                        className={cn(
                          'text-sm',
                          section.state === 'empty' && 'text-muted-foreground',
                        )}
                      >
                        {section.label}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn('text-xs', CHIP_CLASS[section.state])}
                      >
                        {SECTION_STATE_LABEL[section.state]}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
              <Separator />
              <p className="text-muted-foreground px-4 py-3 text-xs">
                {settledCount} of {sections.length} sections settled
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
      <BarVerdict paradigm="dossier" />
      <FooterBar paradigm="dossier" />
    </div>
  )
}
