'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@goodparty_org/styleguide'
import { Check, FolderOpen, Loader2, Send } from 'lucide-react'
import type { Beat } from '../script'
import type { LiveTool, Turn } from '../hooks/useConversation'
import { PRIORITY, type Section } from '../data'
import { FileCard, OutreachCard, PastOutreachCard } from './Cards'
import { FileRail } from './FileRail'

type ChatViewProps = {
  turns: Turn[]
  busy: boolean
  suggestions: Beat[]
  sections: Section[]
  settledCount: number
  totalSections: number
  outreachSent: boolean
  sending: boolean
  onSuggest: (beat: Beat) => void
  onOpenFile: () => void
  onOpenSection: (id: string) => void
  onSendOutreach: () => void
  onReset: () => void
}

const ToolPill = ({ tool }: { tool: LiveTool }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
    {tool.running ? (
      <>
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">{tool.label}</span>
      </>
    ) : (
      <>
        <Check className="size-3 text-success" />
        <span className="text-foreground">{tool.label}</span>
        <span className="text-muted-foreground">&middot; {tool.result}</span>
      </>
    )}
  </span>
)

const ThinkingDots = () => (
  <div className="flex items-center gap-1 py-1">
    {[0, 150, 300].map((delay) => (
      <span
        key={delay}
        className="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse"
        style={{ animationDelay: `${delay}ms` }}
      />
    ))}
  </div>
)

const AgentCard = ({
  turn,
  outreachSent,
  sending,
  onOpenFile,
  onSendOutreach,
}: {
  turn: Extract<Turn, { role: 'agent' }>
  outreachSent: boolean
  sending: boolean
  onOpenFile: () => void
  onSendOutreach: () => void
}) => {
  if (turn.phase !== 'done') return null
  const card = turn.card
  if (card.kind === 'file') {
    return <FileCard note={card.note} onOpen={onOpenFile} />
  }
  if (card.kind === 'past-outreach') {
    return <PastOutreachCard />
  }
  if (card.kind === 'outreach') {
    return (
      <OutreachCard
        sent={outreachSent}
        sending={sending}
        onSend={onSendOutreach}
      />
    )
  }
  return null
}

export const ChatView = ({
  turns,
  busy,
  suggestions,
  sections,
  settledCount,
  totalSections,
  outreachSent,
  sending,
  onSuggest,
  onOpenFile,
  onOpenSection,
  onSendOutreach,
  onReset,
}: ChatViewProps) => {
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ block: 'end' })
    }
  }, [turns])

  return (
    <div className="space-y-6 p-6 pb-40">
      <div className="sticky top-0 z-10 -mx-6 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-foreground">
            Chief of Staff
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            {PRIORITY.office}
          </p>
        </div>
        <Button
          variant="ghost"
          size="small"
          icon={<FolderOpen />}
          onClick={onOpenFile}
          className="shrink-0"
        >
          Maple Ave file
          <span className="text-muted-foreground">
            {' '}
            {settledCount}/{totalSections}
          </span>
        </Button>
      </div>

      {/* The rail keeps the whole path on screen while you talk. The
          conversation stays the wide column; the file is the reference beside
          it, and any row in it is a way into the full view. */}
      <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-4">
            {turns.map((turn) => {
              if (turn.role === 'user') {
                return (
                  <div
                    key={turn.id}
                    className="ml-auto max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground"
                  >
                    {turn.text}
                  </div>
                )
              }

              const paragraphs = turn.text.slice(0, turn.revealed).split('\n\n')

              return (
                <div key={turn.id} className="w-full">
                  {turn.tools.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {turn.tools.map((tool) => (
                        <ToolPill key={tool.name} tool={tool} />
                      ))}
                    </div>
                  ) : null}

                  {turn.phase === 'thinking' ? (
                    <ThinkingDots />
                  ) : (
                    <div className="space-y-3">
                      {paragraphs.map((para, i) => (
                        <p
                          key={i}
                          className="text-sm leading-relaxed text-foreground"
                        >
                          {para}
                          {turn.phase === 'streaming' &&
                          i === paragraphs.length - 1 ? (
                            <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-foreground align-middle" />
                          ) : null}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="mt-3">
                    <AgentCard
                      turn={turn}
                      outreachSent={outreachSent}
                      sending={sending}
                      onOpenFile={onOpenFile}
                      onSendOutreach={onSendOutreach}
                    />
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          <div className="space-y-4">
            {suggestions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((beat) => (
                  <Button
                    key={beat.id}
                    variant="outline"
                    size="medium"
                    disabled={busy}
                    onClick={() => onSuggest(beat)}
                    className="h-auto whitespace-normal py-2 text-left"
                  >
                    {beat.prompt}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  That is the thread played out.
                </p>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={busy}
                  onClick={onReset}
                >
                  Start over
                </Button>
              </div>
            )}

            <div
              className={`flex items-center gap-3 rounded-full border border-border px-4 py-2.5 ${busy ? 'opacity-60' : ''}`}
            >
              <span className="flex-1 text-sm text-muted-foreground">
                Ask me anything about this priority...
              </span>
              <Button size="small" icon={<Send />} disabled={busy}>
                Send
              </Button>
            </div>
          </div>
        </div>

        <FileRail
          sections={sections}
          settledCount={settledCount}
          onOpenSection={onOpenSection}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  )
}
