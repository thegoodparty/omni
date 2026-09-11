'use client'

import { useState } from 'react'
import {
  Button,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  cn,
} from '@styleguide'
import type { PriorityDirective } from '../data/stepProtocol'

// One step question as selectable option cards plus a write-your-own, the same
// affordance the ordinance flow's clarify widget gives. Answering sends the
// option's text as the user's turn; once answered the cards lock and the choice
// stays highlighted.
export default function PriorityQuestion({
  directive,
  answer,
  disabled,
  onAnswer,
}: {
  directive: Extract<PriorityDirective, { kind: 'question' }>
  // The recorded answer for this question, if any. Set means the widget locks.
  answer?: string
  disabled: boolean
  onAnswer: (answer: string) => void
}): React.JSX.Element {
  const [writingOwn, setWritingOwn] = useState(false)
  const [ownText, setOwnText] = useState('')

  const answeredIndex = answer ? directive.options.indexOf(answer) : -1
  const isAnswered = answer !== undefined
  const selectable = !disabled && !isAnswered

  const submitOwn = (): void => {
    const trimmed = ownText.trim()
    if (!trimmed || disabled) return
    onAnswer(trimmed)
    setOwnText('')
    setWritingOwn(false)
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-sm font-medium text-foreground">{directive.ask}</p>

      <RadioGroup
        className="flex flex-col gap-2"
        disabled={disabled || isAnswered}
        value={answeredIndex >= 0 ? String(answeredIndex) : ''}
        onValueChange={(value) => {
          if (isAnswered) return
          const option = directive.options[Number(value)]
          if (option) onAnswer(option)
        }}
      >
        {directive.options.map((option, i) => {
          const id = `priority-opt-${i}-${option.slice(0, 12)}`
          const note = directive.notes[i]
          return (
            <div
              key={option}
              className={cn(
                'flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-colors',
                'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5',
                selectable && 'cursor-pointer hover:border-foreground/20',
              )}
            >
              <Label
                htmlFor={id}
                className={cn(
                  'flex items-start gap-3 text-left',
                  selectable ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <RadioGroupItem
                  value={String(i)}
                  id={id}
                  disabled={disabled || isAnswered}
                  className="mt-0.5 shrink-0 disabled:cursor-default disabled:opacity-100"
                />
                <span className="text-sm font-medium text-foreground select-text">
                  {option}
                </span>
              </Label>
              {note ? (
                <p className="mt-3 border-t border-border/70 pl-8 pt-3 text-sm leading-6 text-muted-foreground">
                  {note}
                </p>
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
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => setWritingOwn(true)}
          className="h-auto w-full justify-start rounded-xl border-border bg-card p-4 text-left text-sm font-normal text-muted-foreground shadow-sm hover:border-foreground/20 hover:bg-card hover:text-muted-foreground"
        >
          Or write your own...
        </Button>
      )}
    </div>
  )
}
