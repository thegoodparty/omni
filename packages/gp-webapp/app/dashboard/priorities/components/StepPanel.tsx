'use client'

import { useState } from 'react'
import { Badge, Button, RadioCardItem, RadioGroup, cn } from '@styleguide'
import { CheckIcon, TriangleAlertIcon } from '@styleguide/components/ui/icons'
import type { PriorityFlowStep } from '../data/steps'
import ListeningStep from './ListeningStep'

// Scripted stand-ins for the agent's step output, so the whole spine can be
// clicked through before the flow's backend exists. Every panel here is shaped
// like the card the agent will fill: same fields, same order, same decision at
// the bottom. The copy is illustrative and names a made-up street on purpose.
//
// Design doc: docs/serve-priority-flow-prompt.md

function LeadIn({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <p className="text-sm text-foreground">{children}</p>
}

function Card({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border bg-card p-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

function QuestionCard({
  question,
  options,
  answer,
  onAnswer,
  idPrefix,
}: {
  question: string
  options: string[]
  answer: string | null
  onAnswer: (answer: string) => void
  idPrefix: string
}): React.JSX.Element {
  return (
    <Card>
      <h3 className="text-sm font-medium text-foreground">{question}</h3>
      <RadioGroup
        className="flex flex-col gap-2"
        value={answer ?? ''}
        disabled={answer !== null}
        onValueChange={onAnswer}
      >
        {options.map((option, index) => (
          <RadioCardItem
            key={option}
            value={option}
            id={`${idPrefix}-${index}`}
            title={option}
          />
        ))}
      </RadioGroup>
      {answer === null ? (
        <span className="text-xs text-muted-foreground">
          Or type your own answer below.
        </span>
      ) : null}
    </Card>
  )
}

function FindingRow({
  label,
  items,
}: {
  label: string
  items: string[]
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item} className="text-sm text-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

const DEFINE_QUESTIONS: { question: string; options: string[] }[] = [
  {
    question: 'Who is this hitting hardest right now?',
    options: [
      'Renters in the older buildings on the low side',
      'Homeowners backing onto the creek',
      'The businesses along the corridor',
    ],
  },
  {
    question: 'What would count as solved by the end of your term?',
    options: [
      'No repeat flooding on the worst blocks',
      'A funded plan with a start date',
      'A rule that stops new building making it worse',
    ],
  },
]

const OPTIONS = [
  {
    title: 'Require on-site stormwater retention for new building',
    summary: 'Stops the problem getting worse, does nothing for today.',
    saysYes: 'Council majority, two readings',
    cost: 'Staff time only',
    time: '2 to 4 months',
    risk: 'Builders will show up to the hearing',
    precedent: 'A same-state city of your size passed this in 2021',
  },
  {
    title: 'Fund the culvert replacement in next year budget',
    summary: 'Fixes the worst two blocks. Competes with everything else.',
    saysYes: 'Council, on the budget calendar',
    cost: 'Capital line, engineer estimate needed',
    time: 'Next cycle, then construction',
    risk: 'Slips a year if it misses the calendar',
    precedent: 'Two peer cities did this after a flood year',
  },
  {
    title: 'Ask the county drainage district to take the channel',
    summary: 'Cheapest for you. Slowest, and not your call.',
    saysYes: 'County board, not your council',
    cost: 'Nothing local',
    time: '6 to 18 months',
    risk: 'They can simply say no',
    precedent: 'One neighboring town got this after two years of asking',
  },
]

const PLAN = [
  {
    what: 'Ask the clerk the agenda deadline for the second March meeting',
    who: 'You',
    when: 'This week',
  },
  {
    what: 'Get the engineer rough order of magnitude on the culvert',
    who: 'Public works director',
    when: 'Within two weeks',
  },
  {
    what: 'Walk the two worst blocks with the neighbors who called',
    who: 'You',
    when: 'Before the first reading',
  },
  {
    what: 'Line up a second sponsor before it hits the agenda',
    who: 'You',
    when: 'Before the agenda deadline',
  },
]

export default function StepPanel({
  step,
  onAdvance,
  advanceLabel,
}: {
  step: PriorityFlowStep
  onAdvance: (() => void) | null
  advanceLabel: string
}): React.JSX.Element {
  const [answers, setAnswers] = useState<(string | null)[]>([null, null])

  const recordAnswer = (index: number, answer: string): void => {
    setAnswers((prev) => prev.map((a, i) => (i === index ? answer : a)))
  }

  const advance = onAdvance ? (
    <Button className="self-start" onClick={onAdvance}>
      {advanceLabel}
    </Button>
  ) : null

  if (step === 'define') {
    const askedCount = answers[0] === null ? 1 : 2
    const settled = answers[0] !== null && answers[1] !== null
    return (
      <div className="flex flex-col gap-4">
        <LeadIn>Let us start with who this actually lands on.</LeadIn>
        {DEFINE_QUESTIONS.slice(0, askedCount).map((q, index) => (
          <QuestionCard
            key={q.question}
            question={q.question}
            options={q.options}
            answer={answers[index] ?? null}
            onAnswer={(answer) => recordAnswer(index, answer)}
            idPrefix={`define-q${index}`}
          />
        ))}
        {settled ? (
          <>
            <Card>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                The problem, as you described it
              </span>
              <p className="text-sm text-foreground">
                Repeat flooding on the low blocks is hitting{' '}
                {answers[0]?.toLowerCase()}, and you will count this as solved
                when there is {answers[1]?.toLowerCase()}.
              </p>
            </Card>
            {advance}
          </>
        ) : null}
      </div>
    )
  }

  if (step === 'evidence') {
    return (
      <div className="flex flex-col gap-4">
        <LeadIn>
          Here is what your district data and the public record already say.
        </LeadIn>
        <Card>
          <FindingRow
            label="Established"
            items={[
              '412 households sit in the two blocks that flooded twice last year',
              'The drainage chapter has not been amended since 1998',
              'Three of your last five meetings had public comment on this',
            ]}
          />
          <FindingRow
            label="Likely"
            items={[
              'Renters are the majority in the worst-hit block, which changes who you hear from',
            ]}
          />
          <FindingRow
            label="Not known"
            items={[
              'What the culvert work would actually cost',
              'Whether the county considers the channel theirs',
            ]}
          />
          <p className="text-xs text-muted-foreground">
            The two unknowns are the ones a colleague will ask about first.
          </p>
        </Card>
        {advance}
      </div>
    )
  }

  if (step === 'listen_problem' || step === 'listen_options') {
    return (
      <ListeningStep
        variant={step === 'listen_problem' ? 'problem' : 'options'}
        onAdvance={onAdvance}
        advanceLabel={advanceLabel}
      />
    )
  }

  if (step === 'options') {
    return (
      <div className="flex flex-col gap-4">
        <LeadIn>
          Three ways to act on this, with what each one costs you.
        </LeadIn>
        {OPTIONS.map((option) => (
          <Card key={option.title}>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-foreground">
                {option.title}
              </h3>
              <p className="text-sm text-muted-foreground">{option.summary}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  Who has to say yes
                </dt>
                <dd className="text-foreground">{option.saysYes}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Rough cost</dt>
                <dd className="text-foreground">{option.cost}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Time</dt>
                <dd className="text-foreground">{option.time}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Main risk</dt>
                <dd className="text-foreground">{option.risk}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">{option.precedent}</p>
          </Card>
        ))}
        {advance}
      </div>
    )
  }

  if (step === 'method') {
    return (
      <div className="flex flex-col gap-4">
        <LeadIn>
          First, what you are allowed to do here. Then what I would pick.
        </LeadIn>
        <Card className="border-warning/40 bg-warning/5">
          <div className="flex items-center gap-2">
            <TriangleAlertIcon
              className="size-4 text-warning-dark"
              aria-hidden
            />
            <span className="text-sm font-medium text-foreground">
              You can act, with one limit
            </span>
          </div>
          <p className="text-sm text-foreground">
            Your council can set retention standards for new building. It cannot
            compel the county to take the channel, and your charter puts the
            capital line on the budget calendar, so the funding path is next
            cycle rather than now.
          </p>
          <p className="text-xs text-muted-foreground">
            Your city attorney should confirm the charter reading before you
            rely on it.
          </p>
        </Card>
        <Card>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What I would pick
          </span>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Badge>1</Badge>
                <span className="text-sm font-medium text-foreground">
                  Ordinance, on the retention standard
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                It is the piece you control, it stops the problem growing, and
                it needs nobody outside your council.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">2</Badge>
                <span className="text-sm font-medium text-foreground">
                  Budget request, for the culvert
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                The fix for the blocks flooding today, but it lives or dies on
                the calendar.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="small">Take the ordinance path</Button>
            <Button size="small" variant="outline">
              Take the budget path
            </Button>
          </div>
        </Card>
        {advance}
      </div>
    )
  }

  if (step === 'plan') {
    return (
      <div className="flex flex-col gap-4">
        <LeadIn>Here is the order I would work it in.</LeadIn>
        <Card>
          <ol className="flex flex-col divide-y divide-border">
            {PLAN.map((item, index) => (
              <li
                key={item.what}
                className={cn(
                  'flex items-start gap-3 py-3',
                  index === 0 && 'pt-0',
                )}
              >
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm text-foreground">{item.what}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.who} · {item.when}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <span className="text-sm font-medium text-foreground">
            Draft the ordinance
          </span>
          <p className="text-sm text-muted-foreground">
            Ordinances takes it from here and keeps the decisions you made.
          </p>
          <Button size="small" variant="outline" className="self-start">
            Open it in Ordinances
          </Button>
        </Card>
        {advance}
      </div>
    )
  }

  // track
  return (
    <div className="flex flex-col gap-4">
      <LeadIn>Nothing has moved on this in three weeks.</LeadIn>
      <Card>
        <div className="flex items-center gap-2">
          <CheckIcon className="size-4 text-success-dark" aria-hidden />
          <span className="text-sm text-foreground">
            Retention ordinance drafted and with your attorney
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TriangleAlertIcon className="size-4 text-warning-dark" aria-hidden />
          <span className="text-sm text-foreground">
            The engineer estimate you asked for is 12 days late
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          The agenda deadline is the thing to protect. Everything else can slip
          a week.
        </p>
      </Card>
      <Card>
        <span className="text-sm font-medium text-foreground">
          Tell people where this stands
        </span>
        <p className="text-sm text-muted-foreground">
          A short update in plain language, for you to edit and send.
        </p>
        <Button size="small" variant="outline" className="self-start">
          Draft an update
        </Button>
      </Card>
    </div>
  )
}
