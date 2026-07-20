'use client'

import { useState } from 'react'
import {
  Button,
  cn,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
} from '@styleguide'
import type { OrdinanceClarifyQuestion } from '@goodparty_org/contracts'
import SourceLine from './SourceLine'

// Renders one clarify question as selectable option cards (radio + title, with
// the rationale and cited source in a divided section below) plus an
// always-present "Or write your own..." card. Selecting an option, or submitting
// a written-in answer, sends the answer as a chat turn; the agent records it and
// asks the next question. Once answered the cards lock and the chosen option
// stays highlighted.
export default function ClarifyQuestionWidget({
  question,
  disabled,
  answer,
  onAnswer,
}: {
  question: OrdinanceClarifyQuestion
  disabled: boolean
  // The recorded answer for this question, if any. When set, the widget locks
  // and highlights the chosen option (the prototype's selected state) instead of
  // taking input.
  answer?: string
  onAnswer: (answer: string) => void
}): React.JSX.Element {
  const [writingOwn, setWritingOwn] = useState(false)
  const [ownText, setOwnText] = useState('')

  const answeredIndex =
    answer != null ? question.options.findIndex((o) => o.label === answer) : -1
  const isAnswered = answer != null
  const selectable = !disabled && !isAnswered

  const submitOwn = (): void => {
    const trimmed = ownText.trim()
    if (!trimmed || disabled) return
    onAnswer(trimmed)
    setOwnText('')
    setWritingOwn(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-foreground">{question.question}</p>

      <RadioGroup
        className="flex flex-col gap-2"
        disabled={disabled || isAnswered}
        value={answeredIndex >= 0 ? String(answeredIndex) : ''}
        onValueChange={(value) => {
          if (isAnswered) return
          const option = question.options[Number(value)]
          if (option) onAnswer(option.label)
        }}
      >
        {question.options.map((option, i) => {
          const id = `${question.questionId}-opt-${i}`
          return (
            <div
              key={id}
              className={cn(
                'flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-colors',
                'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5',
                selectable && 'cursor-pointer hover:border-foreground/20',
              )}
            >
              <Label
                htmlFor={id}
                className={cn(
                  'flex items-center gap-3 text-left',
                  selectable ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <RadioGroupItem
                  value={String(i)}
                  id={id}
                  disabled={disabled || isAnswered}
                  className="shrink-0 disabled:cursor-default disabled:opacity-100"
                />
                <span className="text-sm font-medium text-foreground">
                  {option.label}
                </span>
              </Label>
              {option.rationale || option.source ? (
                <div className="mt-3 flex flex-col gap-2 border-t border-border/70 pl-8 pt-3">
                  {option.rationale ? (
                    <p className="text-sm leading-6 text-muted-foreground">
                      <span className="font-semibold text-foreground/80">
                        Why this option:{' '}
                      </span>
                      {option.rationale}
                    </p>
                  ) : null}
                  {option.source ? <SourceLine source={option.source} /> : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </RadioGroup>

      {isAnswered && answeredIndex < 0 ? (
        <div className="rounded-xl border border-primary bg-primary/5 p-4 text-sm text-foreground shadow-sm">
          {answer}
        </div>
      ) : null}

      {isAnswered ? null : writingOwn ? (
        <div className="flex items-center gap-2">
          <Input
            value={ownText}
            onChange={(e) => setOwnText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitOwn()
              }
            }}
            placeholder="Type your answer..."
            disabled={disabled}
            autoFocus
          />
          <Button
            type="button"
            size="small"
            onClick={submitOwn}
            disabled={disabled || ownText.trim().length === 0}
          >
            Send
          </Button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setWritingOwn(true)}
          className="cursor-pointer rounded-xl border border-border bg-card p-4 text-left text-sm text-muted-foreground shadow-sm transition-colors hover:border-foreground/20 disabled:cursor-default disabled:opacity-50 disabled:hover:border-border"
        >
          Or write your own...
        </button>
      )}
    </div>
  )
}
