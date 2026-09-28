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
import { ParadigmNote } from './ParadigmNote'

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

  const settledCount = sections.filter(
    (section: DossierSection) => section.state === 'confirmed',
  ).length

  const selected = sections.find(
    (section: DossierSection) => section.id === selectedId,
  )

  const toggleFlag = () => {
    if (flagged) {
      setSections(MAPLE.sections)
      setFlagged(false)
      return
    }
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

  return (
    <div className="p-6 space-y-6">
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
          <div className="border-border flex items-center gap-2 rounded-lg border p-3">
            <span className="text-muted-foreground flex-1 text-sm">
              Ask me anything about this priority...
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
                    onClick={() => setSelectedId(null)}
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
                      onClick={() => setSelectedId(section.id)}
                      className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40"
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
    </div>
  )
}
