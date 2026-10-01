'use client'

import { useState } from 'react'
import {
  Button,
  Checkbox,
  cn,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
} from '@styleguide'
import type {
  ChatClarifyOption,
  ChatClarifyQuestion,
} from '@goodparty_org/contracts'
import SourceLine from './SourceLine'

// A multi-select answer goes back as one readable line, the chosen labels in
// option order: "A", "A and B", "A, B, and C". Option order, not click order,
// so the same set always reads the same way and parses back the same way.
const choiceSeparator = (count: number, position: number): string => {
  if (position === count - 1) return ''
  if (count === 2) return ' and '
  return position === count - 2 ? ', and ' : ', '
}

export const formatClarifyChoices = (labels: string[]): string =>
  labels.map((label, i) => label + choiceSeparator(labels.length, i)).join('')

// The inverse of formatClarifyChoices: the option indexes whose formatted line
// is exactly this answer, or null for a written-in answer. Labels are matched
// whole and in option order, so a label holding a comma or an "and" still
// parses; fewer choices are tried first.
export const parseClarifyChoices = (
  answer: string,
  labels: string[],
): number[] | null => {
  const walk = (
    count: number,
    from: number,
    position: number,
    at: number,
  ): number[] | null => {
    if (position === count) return at === answer.length ? [] : null
    for (let i = from; i < labels.length; i++) {
      const piece = labels[i] + choiceSeparator(count, position)
      if (!answer.startsWith(piece, at)) continue
      const rest = walk(count, i + 1, position + 1, at + piece.length)
      if (rest) return [i, ...rest]
    }
    return null
  }
  for (let count = 1; count <= labels.length; count++) {
    const match = walk(count, 0, 0, 0)
    if (match) return match
  }
  return null
}

const OptionDetail = ({
  option,
}: {
  option: ChatClarifyOption
}): React.JSX.Element | null =>
  option.rationale || option.source ? (
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
  ) : null

// A drag to highlight the option text ends in a click on the label; a
// non-empty selection here means the user was selecting (a plain click clears
// any prior selection on mousedown), so don't let it toggle the input.
const ignoreTextSelection = (e: React.MouseEvent<HTMLLabelElement>): void => {
  if (window.getSelection()?.toString()) e.preventDefault()
}

// Renders one clarify question as selectable option cards (radio + title, with
// the rationale and cited source in a divided section below) plus an
// always-present "Or write your own..." card. Selecting an option, or submitting
// a written-in answer, sends the answer as a chat turn; the agent records it and
// asks the next question. Once answered the cards lock and the chosen option
// stays highlighted. A multiSelect question renders the same cards as
// checkboxes and sends the checked set with one button.
export default function ClarifyQuestionWidget({
  question,
  disabled,
  answer,
  onAnswer,
}: {
  question: ChatClarifyQuestion
  disabled: boolean
  // The recorded answer for this question, if any. When set, the widget locks
  // and highlights the chosen option (the prototype's selected state) instead of
  // taking input.
  answer?: string
  onAnswer: (answer: string) => void
}): React.JSX.Element {
  const [writingOwn, setWritingOwn] = useState(false)
  const [ownText, setOwnText] = useState('')
  const [checked, setChecked] = useState<number[]>([])

  const answeredIndex =
    answer != null ? question.options.findIndex((o) => o.label === answer) : -1
  const answeredChoices =
    answer != null && question.multiSelect
      ? parseClarifyChoices(
          answer,
          question.options.map((o) => o.label),
        )
      : null
  const isAnswered = answer != null
  const selectable = !disabled && !isAnswered
  const writtenIn = question.multiSelect
    ? answeredChoices === null
    : answeredIndex < 0
  const shownChecked = isAnswered ? (answeredChoices ?? []) : checked
  const promptId = `${question.questionId}-question`

  const toggle = (index: number, on: boolean): void => {
    if (!selectable) return
    setChecked((prev) =>
      on
        ? [...prev.filter((i) => i !== index), index].sort((a, b) => a - b)
        : prev.filter((i) => i !== index),
    )
  }

  const submitChecked = (): void => {
    if (!selectable || checked.length === 0) return
    onAnswer(
      formatClarifyChoices(
        checked.flatMap((i) => question.options[i]?.label ?? []),
      ),
    )
  }

  const submitOwn = (): void => {
    const trimmed = ownText.trim()
    if (!trimmed || disabled) return
    onAnswer(trimmed)
    setOwnText('')
    setWritingOwn(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <p
        id={question.multiSelect ? promptId : undefined}
        className="text-sm font-medium text-foreground"
      >
        {question.question}
      </p>

      {question.multiSelect ? (
        <>
          <div
            role="group"
            aria-labelledby={promptId}
            className="flex flex-col gap-2"
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
                    onClick={ignoreTextSelection}
                    className={cn(
                      'flex items-center gap-3 text-left',
                      selectable ? 'cursor-pointer' : 'cursor-default',
                    )}
                  >
                    <Checkbox
                      id={id}
                      checked={shownChecked.includes(i)}
                      onCheckedChange={(state) => toggle(i, state === true)}
                      disabled={disabled || isAnswered}
                      className="shrink-0 disabled:cursor-default disabled:opacity-100"
                    />
                    <span className="text-sm font-medium text-foreground select-text">
                      {option.label}
                    </span>
                  </Label>
                  <OptionDetail option={option} />
                </div>
              )
            })}
          </div>
          {isAnswered ? null : (
            <Button
              type="button"
              size="small"
              className="self-start"
              onClick={submitChecked}
              disabled={disabled || checked.length === 0}
            >
              {checked.length === 1 ? 'Use this' : 'Use these'}
            </Button>
          )}
        </>
      ) : (
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
                  onClick={ignoreTextSelection}
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
                  <span className="text-sm font-medium text-foreground select-text">
                    {option.label}
                  </span>
                </Label>
                <OptionDetail option={option} />
              </div>
            )
          })}
        </RadioGroup>
      )}

      {isAnswered && writtenIn ? (
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
