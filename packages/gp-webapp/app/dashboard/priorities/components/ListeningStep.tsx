'use client'

import { useState } from 'react'
import { Button, Textarea, cn } from '@styleguide'

// The listening step, scripted. This is the interaction the design doc argues
// hardest about, so the prototype covers all three answers: a route chosen, a
// "not yet" that gets held and brought back, and a flat no that gets one honest
// line and then gets out of the way.
//
// Design doc: docs/serve-priority-flow-prompt.md, LISTEN_RULES.

type Outcome = 'choosing' | 'outreach' | 'notes' | 'deferred' | 'declined'

const GROUPS = {
  problem: [
    {
      who: 'Renters on the two blocks that flooded',
      size: 'About 260 households',
      how: 'Knock the blocks, or a text to the ones with numbers on file',
    },
    {
      who: 'Homeowners backing onto the creek',
      size: 'About 150 households',
      how: 'A short poll, they answer these',
    },
  ],
  options: [
    {
      who: 'Everyone on the flood blocks',
      size: 'About 410 households',
      how: 'One question, two options, by text',
    },
    {
      who: 'The corridor businesses',
      size: '23 storefronts',
      how: 'The business association meeting on the 14th',
    },
  ],
}

const MISSING = {
  problem:
    'The renters who moved in this year are not in your data at all, and they are the ones who have not been through a flood here yet. The apartment manager on Oak can get you in front of them.',
  options:
    'Day-shift workers will not answer a 6pm call. The Saturday market is where you will actually find them.',
}

export default function ListeningStep({
  variant,
  onAdvance,
  advanceLabel,
}: {
  variant: 'problem' | 'options'
  onAdvance: (() => void) | null
  advanceLabel: string
}): React.JSX.Element {
  const [outcome, setOutcome] = useState<Outcome>('choosing')

  const advance = onAdvance ? (
    <Button className="self-start" onClick={onAdvance}>
      {advanceLabel}
    </Button>
  ) : null

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground">
        {variant === 'problem'
          ? 'Before we look at fixes, here is who I would hear from.'
          : 'Two groups whose answer would actually change the choice.'}
      </p>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        {GROUPS[variant].map((group) => (
          <div key={group.who} className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">
              {group.who}
            </span>
            <span className="text-xs text-muted-foreground">{group.size}</span>
            <span className="text-sm text-muted-foreground">{group.how}</span>
          </div>
        ))}
        <p className="border-t border-border pt-3 text-sm text-muted-foreground">
          {MISSING[variant]}
        </p>
        <Button size="small" variant="ghost" className="self-start">
          Save this as a list
        </Button>
      </div>

      {outcome === 'choosing' ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-foreground">
            How do you want to do this?
          </span>
          <div className="flex flex-wrap gap-2">
            <Button size="small" onClick={() => setOutcome('outreach')}>
              Run it from here
            </Button>
            <Button
              size="small"
              variant="outline"
              onClick={() => setOutcome('notes')}
            >
              I have already heard from people
            </Button>
            <Button
              size="small"
              variant="outline"
              onClick={() => setOutcome('deferred')}
            >
              Yes, but not yet
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => setOutcome('declined')}
            >
              Move on without it
            </Button>
          </div>
        </div>
      ) : null}

      {outcome === 'outreach' ? (
        <OutcomeCard
          title="Out in the field"
          body="The text went to 260 households on the flood blocks. Answers usually come back within three days, and I will pick this up here when they do."
        >
          <Button size="small" variant="outline" className="self-start">
            Open it in Constituent Outreach
          </Button>
        </OutcomeCard>
      ) : null}

      {outcome === 'notes' ? (
        <OutcomeCard
          title="What did you hear, and from whom?"
          body="Type it the way you would tell a colleague. I will keep it with the rest of this priority."
        >
          <Textarea
            rows={3}
            placeholder="Eleven people at the ward meeting, mostly renters on Oak. Every one of them raised the culvert."
          />
          <Button size="small" className="self-start">
            Save what you heard
          </Button>
        </OutcomeCard>
      ) : null}

      {outcome === 'deferred' ? (
        <OutcomeCard
          title="Held"
          body="I will bring it back before you lock in a path, since that is the point where it stops being free to skip."
        />
      ) : null}

      {outcome === 'declined' ? (
        <OutcomeCard
          title="Your call"
          body="Worth saying once: nobody on the blocks this lands on will have been asked, and that is the first thing a colleague or a neighbor will notice. I will note it and move on."
          tone="warning"
        />
      ) : null}

      {outcome !== 'choosing' ? advance : null}
    </div>
  )
}

function OutcomeCard({
  title,
  body,
  tone = 'neutral',
  children,
}: {
  title: string
  body: string
  tone?: 'neutral' | 'warning'
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4',
        tone === 'warning'
          ? 'border-warning/40 bg-warning/5'
          : 'border-border bg-card',
      )}
    >
      <span className="text-sm font-medium text-foreground">{title}</span>
      <p className="text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  )
}
