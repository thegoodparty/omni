'use client'

import { useState } from 'react'
import { Button, Textarea, cn } from '@styleguide'
import {
  ASSISTANT_BUBBLE,
  AssistantRow,
  UserBubble,
} from '../../shared/agent-chat/chatUI'

// The listening step, scripted. This is the interaction the design doc argues
// hardest about, so the prototype covers all four answers: a route chosen,
// notes the official already has, a "not yet" that gets held and brought back,
// and a flat no that gets one honest line and then gets out of the way.
//
// Design doc: docs/serve-priority-flow-prompt.md, LISTEN_RULES.

type Outcome = 'choosing' | 'outreach' | 'notes' | 'deferred' | 'declined'

const CHOICE_LABELS: Record<Exclude<Outcome, 'choosing'>, string> = {
  outreach: 'Run it from here',
  notes: 'I have already heard from people',
  deferred: 'Yes, but not yet',
  declined: 'Move on without it',
}

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

const LEAD_IN = {
  problem: 'Before we look at fixes, here is who I would hear from.',
  options: 'Two groups whose answer would actually change the choice.',
}

export default function ListeningStep({
  variant,
  opener,
  advance,
}: {
  variant: 'problem' | 'options'
  opener: React.ReactNode
  advance: React.ReactNode
}): React.JSX.Element {
  const [outcome, setOutcome] = useState<Outcome>('choosing')

  return (
    <>
      <AssistantRow>
        {opener}
        <div className={ASSISTANT_BUBBLE}>
          <p>{LEAD_IN[variant]}</p>
        </div>
        <div className="flex w-full flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
          {GROUPS[variant].map((group) => (
            <div key={group.who} className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                {group.who}
              </span>
              <span className="text-xs text-muted-foreground">
                {group.size}
              </span>
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
          <div className="flex w-full flex-col gap-2">
            <div className={ASSISTANT_BUBBLE}>
              <p>How do you want to do this?</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="small" onClick={() => setOutcome('outreach')}>
                {CHOICE_LABELS.outreach}
              </Button>
              <Button
                size="small"
                variant="outline"
                onClick={() => setOutcome('notes')}
              >
                {CHOICE_LABELS.notes}
              </Button>
              <Button
                size="small"
                variant="outline"
                onClick={() => setOutcome('deferred')}
              >
                {CHOICE_LABELS.deferred}
              </Button>
              <Button
                size="small"
                variant="ghost"
                onClick={() => setOutcome('declined')}
              >
                {CHOICE_LABELS.declined}
              </Button>
            </div>
          </div>
        ) : null}
      </AssistantRow>

      {outcome !== 'choosing' ? (
        <UserBubble>{CHOICE_LABELS[outcome]}</UserBubble>
      ) : null}

      {outcome === 'outreach' ? (
        <AssistantRow>
          <OutcomeCard
            title="Out in the field"
            body="The text went to 260 households on the flood blocks. Answers usually come back within three days, and I will pick this up here when they do."
          >
            <Button size="small" variant="outline" className="self-start">
              Open it in Constituent Outreach
            </Button>
          </OutcomeCard>
        </AssistantRow>
      ) : null}

      {outcome === 'notes' ? (
        <AssistantRow>
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
        </AssistantRow>
      ) : null}

      {outcome === 'deferred' ? (
        <AssistantRow>
          <OutcomeCard
            title="Held"
            body="I will bring it back before you lock in a path, since that is the point where it stops being free to skip."
          />
        </AssistantRow>
      ) : null}

      {outcome === 'declined' ? (
        <AssistantRow>
          <OutcomeCard
            title="Your call"
            body="Worth saying once: nobody on the blocks this lands on will have been asked, and that is the first thing a colleague or a neighbor will notice. I will note it and move on."
            tone="warning"
          />
        </AssistantRow>
      ) : null}

      {outcome !== 'choosing' ? advance : null}
    </>
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
        'flex w-full flex-col gap-3 rounded-lg border p-4 shadow-sm',
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
