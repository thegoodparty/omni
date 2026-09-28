'use client'

import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  RadioGroup,
  RadioGroupItem,
  Stepper,
} from '@goodparty_org/styleguide'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { ParadigmNote } from './ParadigmNote'
import { MAPLE } from '../data'
import { FLOW_STEPS, type FlowStep } from '../flow'

const lowerFirst = (value: string) =>
  value.length > 0 ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value

export const StepperToday = () => {
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [outreachSent, setOutreachSent] = useState(false)
  const [totalAnswered, setTotalAnswered] = useState(0)
  const [finished, setFinished] = useState(false)

  const step: FlowStep | undefined = FLOW_STEPS[stepIndex]

  if (!step) {
    return null
  }

  const prevStep = FLOW_STEPS[stepIndex - 1]
  const nextStep = FLOW_STEPS[stepIndex + 1]
  const isLastStep = stepIndex === FLOW_STEPS.length - 1
  const activeQuestion =
    answers.length < step.questions.length
      ? step.questions[answers.length]
      : undefined
  const allAnswered = answers.length === step.questions.length

  const continueLabel = isLastStep
    ? 'Finish'
    : nextStep
      ? `Next: ${lowerFirst(nextStep.short)}`
      : 'Continue'

  const resetStepState = () => {
    setAnswers([])
    setConfirmed(false)
    setOutreachSent(false)
  }

  const selectAnswer = (label: string) => {
    setAnswers((prev) => [...prev, label])
    setTotalAnswered((n) => n + 1)
  }

  const handleBack = () => {
    setStepIndex((i) => Math.max(0, i - 1))
    resetStepState()
  }

  const handleContinue = () => {
    if (isLastStep) {
      setFinished(true)
      return
    }
    setStepIndex((i) => i + 1)
    resetStepState()
  }

  const handleSkip = () => setFinished(true)

  const handleStartOver = () => {
    setStepIndex(0)
    resetStepState()
    setTotalAnswered(0)
    setFinished(false)
  }

  const gateRows = [
    { done: confirmed, label: 'Settle this step: done when you answer above' },
    { done: outreachSent, label: 'Review the outreach I built' },
    {
      done: outreachSent,
      label: `Review ${step.orgs.length} organization${step.orgs.length === 1 ? '' : 's'} worth calling`,
    },
  ]

  return (
    <div className="p-6 space-y-6">
      <ParadigmNote
        name="Stepper (today)"
        oneLine="A linear seven-step wizard you walk front to back."
        buys="The structure is unmissable, which is exactly what officials say generic AI chat lacks."
        costs="Governing is not linear. Learning something new means going 'back', and every step must be cleared before the next one opens."
      />

      {finished ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm font-medium text-foreground">
              That is one priority, start to finish.
            </p>
            <p className="text-xs text-muted-foreground">
              {FLOW_STEPS.length} steps, {totalAnswered} questions,{' '}
              {FLOW_STEPS.length * 3} agent turns.
            </p>
            <Button variant="outline" size="small" onClick={handleStartOver}>
              Start over
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Stepper
                currentStep={stepIndex + 1}
                totalSteps={FLOW_STEPS.length}
              />
              <Button
                variant="ghost"
                size="small"
                className="shrink-0 text-muted-foreground"
                onClick={handleSkip}
              >
                Skip to the end
              </Button>
            </div>
            <p className="text-xs font-medium uppercase tracking-widest text-primary">
              {step.stage} · {step.short}
            </p>
          </div>

          <h2 className="text-lg font-semibold text-foreground">
            {MAPLE.title}
          </h2>

          {stepIndex > 0 && prevStep && (
            <Button
              variant="ghost"
              size="small"
              className="gap-2 px-0"
              onClick={handleBack}
            >
              <ChevronLeft className="size-4" aria-hidden />
              Back to {lowerFirst(prevStep.short)}
            </Button>
          )}

          <div className="rounded-lg bg-muted p-4 space-y-1">
            <p className="text-sm font-bold text-foreground">
              {step.opener.title}
            </p>
            <p className="text-sm text-foreground">{step.opener.caption}</p>
          </div>

          <p className="text-sm text-foreground">{step.prose}</p>

          {answers.map((answer, i) => {
            const question = step.questions[i]
            if (!question) {
              return null
            }
            const option = question.options.find((o) => o.label === answer)
            return (
              <div
                key={question.ask}
                className="rounded-xl border border-border bg-card p-4 space-y-2"
              >
                <p className="text-sm font-medium text-foreground">
                  {question.ask}
                </p>
                <div className="flex flex-col gap-1 rounded-xl border border-primary bg-primary/5 p-3">
                  <div className="flex items-center gap-2">
                    <Check
                      className="size-4 shrink-0 text-primary"
                      aria-hidden
                    />
                    <span className="text-sm text-foreground">{answer}</span>
                  </div>
                  {option && (
                    <p className="pl-6 text-xs text-muted-foreground">
                      {option.note}
                    </p>
                  )}
                </div>
              </div>
            )
          })}

          {activeQuestion && (
            <Card>
              <CardContent className="space-y-4 pt-6">
                <p className="text-sm font-medium text-foreground">
                  {activeQuestion.ask}
                </p>
                <RadioGroup
                  value={undefined}
                  onValueChange={(value: string) => selectAnswer(value)}
                  className="gap-3"
                >
                  {activeQuestion.options.map((option) => (
                    <label
                      key={option.label}
                      htmlFor={option.label}
                      className="flex cursor-pointer flex-col gap-1 rounded-xl border border-border p-3 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value={option.label}
                          id={option.label}
                        />
                        <span className="text-sm text-foreground">
                          {option.label}
                        </span>
                      </div>
                      <p className="pl-7 text-xs text-muted-foreground">
                        {option.note}
                      </p>
                    </label>
                  ))}
                </RadioGroup>
                <Button variant="outline" className="w-full">
                  Or write your own...
                </Button>
              </CardContent>
            </Card>
          )}

          {allAnswered && (
            <Card>
              <CardContent className="space-y-3 pt-6">
                <p className="text-sm font-medium text-foreground">
                  What this step settled
                </p>
                <p className="text-sm text-foreground">{step.settled}</p>
                {confirmed ? (
                  <p className="flex items-center gap-1 text-xs text-success">
                    <Check className="size-3.5" aria-hidden />
                    Confirmed
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <Button size="small" onClick={() => setConfirmed(true)}>
                      Yes, that is it
                    </Button>
                    <Button
                      size="small"
                      variant="outline"
                      onClick={() => setConfirmed(false)}
                    >
                      Not quite
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {confirmed && (
            <Card>
              <CardContent className="space-y-3 pt-6">
                <p className="text-sm font-medium text-foreground">
                  Outreach I built
                </p>
                <p className="text-sm text-foreground">
                  {step.outreach.who}, {step.outreach.count.toLocaleString()}{' '}
                  people, via {step.outreach.channel}
                </p>
                <p className="text-sm text-muted-foreground">
                  {step.outreach.message}
                </p>
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => setOutreachSent(true)}
                >
                  Reach out to them
                </Button>
                {outreachSent && (
                  <p className="flex items-center gap-1 text-xs text-success">
                    <Check className="size-3.5" aria-hidden />
                    Sent
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {outreachSent && (
            <Card>
              <CardContent className="space-y-3 pt-6">
                <p className="text-sm font-medium text-foreground">
                  Organizations worth calling
                </p>
                <div className="space-y-3">
                  {step.orgs.map((org) => (
                    <div key={org.name}>
                      <p className="text-sm font-medium text-foreground">
                        {org.name}
                      </p>
                      <p className="text-sm text-muted-foreground">{org.why}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
            <p className="text-sm font-medium text-foreground">
              Before you can continue
            </p>
            <div className="space-y-2">
              {gateRows.map((row, i) => (
                <div key={row.label} className="flex items-start gap-2">
                  {row.done ? (
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-success"
                      aria-hidden
                    />
                  ) : (
                    <Badge variant="secondary" className="mt-0.5 shrink-0">
                      {i + 1}
                    </Badge>
                  )}
                  <p className="text-sm text-muted-foreground">{row.label}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              The Continue button appears after all three. This repeats on each
              of the seven steps.
            </p>
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={!outreachSent}
              onClick={handleContinue}
            >
              {continueLabel}
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
