'use client'

import { useState } from 'react'
import { Badge, Button, RadioCardItem, RadioGroup, cn } from '@styleguide'
import { CheckIcon, TriangleAlertIcon } from '@styleguide/components/ui/icons'
import {
  ASSISTANT_BUBBLE,
  AssistantRow,
  UserBubble,
} from '../../shared/agent-chat/chatUI'
import {
  PRIORITY_STEP_CAPTIONS,
  PRIORITY_STEP_LABELS,
  type PriorityFlowStep,
} from '../data/steps'
import ListeningStep from './ListeningStep'

// Scripted stand-ins for the agent's step output, so the whole spine can be
// clicked through before the flow's backend exists. These render as real
// assistant turns (avatar, bubble, then the structured cards below it) because
// the shape of the turn is half of what we are testing. Every card here is
// shaped like the one the agent will fill: same fields, same order, same
// decision at the bottom. The copy is illustrative and names a made-up street.
//
// Design doc: docs/serve-priority-flow-prompt.md

// The step's question and caption, spoken by the agent rather than printed as a
// page heading — the ordinance flow puts the same content in its opening turn.
function StepOpener({ step }: { step: PriorityFlowStep }): React.JSX.Element {
  return (
    <div className={ASSISTANT_BUBBLE}>
      <p className="font-medium">{PRIORITY_STEP_LABELS[step]}</p>
      <p>{PRIORITY_STEP_CAPTIONS[step]}</p>
    </div>
  )
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
        'flex w-full flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  )
}

function CardTitle({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
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
      <CardTitle>{label}</CardTitle>
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
  advance,
}: {
  step: PriorityFlowStep
  advance: React.ReactNode
}): React.JSX.Element {
  const [answers, setAnswers] = useState<(string | null)[]>([null, null])

  const recordAnswer = (index: number, answer: string): void => {
    setAnswers((prev) => prev.map((a, i) => (i === index ? answer : a)))
  }

  if (step === 'define') {
    const askedCount = answers[0] === null ? 1 : 2
    const settled = answers[0] !== null && answers[1] !== null
    return (
      <>
        <AssistantRow>
          <StepOpener step={step} />
          <div className={ASSISTANT_BUBBLE}>
            <p>Let us start with who this actually lands on.</p>
          </div>
          <QuestionCard
            question={DEFINE_QUESTIONS[0]!.question}
            options={DEFINE_QUESTIONS[0]!.options}
            answer={answers[0] ?? null}
            onAnswer={(answer) => recordAnswer(0, answer)}
            idPrefix="define-q0"
          />
        </AssistantRow>

        {answers[0] ? <UserBubble>{answers[0]}</UserBubble> : null}

        {askedCount === 2 ? (
          <AssistantRow>
            <QuestionCard
              question={DEFINE_QUESTIONS[1]!.question}
              options={DEFINE_QUESTIONS[1]!.options}
              answer={answers[1] ?? null}
              onAnswer={(answer) => recordAnswer(1, answer)}
              idPrefix="define-q1"
            />
          </AssistantRow>
        ) : null}

        {answers[1] ? <UserBubble>{answers[1]}</UserBubble> : null}

        {settled ? (
          <AssistantRow>
            <Card>
              <CardTitle>The problem, as you described it</CardTitle>
              <p className="text-sm text-foreground">
                Repeat flooding on the low blocks is hitting{' '}
                {answers[0]?.toLowerCase()}, and you will count this as solved
                when there is {answers[1]?.toLowerCase()}.
              </p>
            </Card>
          </AssistantRow>
        ) : null}

        {settled ? advance : null}
      </>
    )
  }

  if (step === 'evidence') {
    return (
      <>
        <AssistantRow>
          <StepOpener step={step} />
          <div className={ASSISTANT_BUBBLE}>
            <p>
              Here is what your district data and the public record already say.
            </p>
          </div>
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
        </AssistantRow>
        {advance}
      </>
    )
  }

  if (step === 'listen_problem' || step === 'listen_options') {
    return (
      <ListeningStep
        variant={step === 'listen_problem' ? 'problem' : 'options'}
        opener={<StepOpener step={step} />}
        advance={advance}
      />
    )
  }

  if (step === 'options') {
    return (
      <>
        <AssistantRow>
          <StepOpener step={step} />
          <div className={ASSISTANT_BUBBLE}>
            <p>Three ways to act on this, with what each one costs you.</p>
          </div>
          {OPTIONS.map((option) => (
            <Card key={option.title}>
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium text-foreground">
                  {option.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {option.summary}
                </p>
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
              <p className="text-xs text-muted-foreground">
                {option.precedent}
              </p>
            </Card>
          ))}
        </AssistantRow>
        {advance}
      </>
    )
  }

  if (step === 'method') {
    return (
      <>
        <AssistantRow>
          <StepOpener step={step} />
          <div className={ASSISTANT_BUBBLE}>
            <p>
              First, what you are allowed to do here. Then what I would pick.
            </p>
          </div>
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
              Your council can set retention standards for new building. It
              cannot compel the county to take the channel, and your charter
              puts the capital line on the budget calendar, so the funding path
              is next cycle rather than now.
            </p>
            <p className="text-xs text-muted-foreground">
              Your city attorney should confirm the charter reading before you
              rely on it.
            </p>
          </Card>
          <Card>
            <CardTitle>What I would pick</CardTitle>
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
        </AssistantRow>
        {advance}
      </>
    )
  }

  if (step === 'plan') {
    return (
      <>
        <AssistantRow>
          <StepOpener step={step} />
          <div className={ASSISTANT_BUBBLE}>
            <p>Here is the order I would work it in.</p>
          </div>
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
        </AssistantRow>
        {advance}
      </>
    )
  }

  // track
  return (
    <>
      <AssistantRow>
        <StepOpener step={step} />
        <div className={ASSISTANT_BUBBLE}>
          <p>Nothing has moved on this in three weeks.</p>
        </div>
        <Card>
          <div className="flex items-center gap-2">
            <CheckIcon className="size-4 text-success-dark" aria-hidden />
            <span className="text-sm text-foreground">
              Retention ordinance drafted and with your attorney
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TriangleAlertIcon
              className="size-4 text-warning-dark"
              aria-hidden
            />
            <span className="text-sm text-foreground">
              The engineer estimate you asked for is 12 days late
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            The agenda deadline is the thing to protect. Everything else can
            slip a week.
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
      </AssistantRow>
      {advance}
    </>
  )
}
