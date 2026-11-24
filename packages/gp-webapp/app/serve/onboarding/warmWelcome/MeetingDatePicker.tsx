import { useState, type CSSProperties, type ReactNode } from 'react'
import { addMonths, format, getDaysInMonth, startOfMonth } from 'date-fns'
import {
  Button,
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@styleguide'
import { WARM_WELCOME_COPY } from './warmWelcomeConfig'

const MONTHS_AHEAD = 12
const FIRST_TIME_MINUTES = 8 * 60
const LAST_TIME_MINUTES = 21 * 60 + 30
const TIME_STEP_MINUTES = 30

export interface PickedDate {
  day: Date
  startMinutes: number
}

const ordinal = (day: number): string => {
  const tens = day % 100
  if (tens >= 11 && tens <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'
}

const clock = (minutes: number): string =>
  `${((Math.floor(minutes / 60) + 11) % 12) + 1}:${String(minutes % 60).padStart(2, '0')}`

const half = (minutes: number): string => (minutes < 12 * 60 ? 'am' : 'pm')

// Every half hour from 8:00 am to 9:30 pm, plus the time the picker opened
// on when the schedule's own time falls between two of them.
const timeOptions = (initial: number): number[] => {
  const times: number[] = []
  for (
    let minutes = FIRST_TIME_MINUTES;
    minutes <= LAST_TIME_MINUTES;
    minutes += TIME_STEP_MINUTES
  ) {
    times.push(minutes)
  }
  return times.includes(initial)
    ? times
    : [...times, initial].sort((a, b) => a - b)
}

type Part = 'month' | 'day' | 'time'

// One word of the sentence. Tapping it opens a small menu under it.
const Word = ({
  label,
  width,
  open,
  onOpenChange,
  menuClassName,
  word,
  children,
}: {
  label: string
  width: string
  open: boolean
  onOpenChange: (open: boolean) => void
  menuClassName: string
  word: ReactNode
  children: ReactNode
}): React.JSX.Element => (
  <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>
      {/* A word of display type with a dotted underline, which no
          styleguide control draws. */}
      <button
        type="button"
        aria-label={label}
        className="ww-date-word"
        style={{ width } as CSSProperties}
      >
        {word}
      </button>
    </PopoverTrigger>
    <PopoverContent
      sideOffset={14}
      className={`max-h-[min(60svh,400px)] w-auto max-w-[calc(100vw-32px)] overflow-auto ${menuClassName}`}
    >
      {children}
    </PopoverContent>
  </Popover>
)

// The date as a sentence, "January 7th at 7:00 pm", starting on the meeting
// we found. Months run from this month to a year out.
export const MeetingDatePicker = ({
  value,
  today,
  onChange,
}: {
  value: PickedDate
  today: Date
  onChange: (value: PickedDate) => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.meeting
  const [open, setOpen] = useState<Part | null>(null)
  const [times] = useState(() => timeOptions(value.startMinutes))
  const months = Array.from({ length: MONTHS_AHEAD }, (_, index) =>
    addMonths(startOfMonth(today), index),
  )
  const month = startOfMonth(value.day)
  const dayOfMonth = value.day.getDate()
  const toggle = (part: Part) => (next: boolean) => setOpen(next ? part : null)

  const pickMonth = (next: Date, keepOpen = false): void => {
    const earliest =
      next.getTime() === startOfMonth(today).getTime() ? today.getDate() : 1
    const day = Math.max(earliest, Math.min(dayOfMonth, getDaysInMonth(next)))
    onChange({
      ...value,
      day: new Date(next.getFullYear(), next.getMonth(), day),
    })
    if (!keepOpen) setOpen(null)
  }

  return (
    <div className="ww-date" role="group" aria-label={copy.pickLabel}>
      <Word
        label={copy.month}
        width="4.7em"
        open={open === 'month'}
        onOpenChange={toggle('month')}
        menuClassName="grid grid-cols-2 gap-1 p-2"
        word={format(value.day, 'MMMM')}
      >
        {months.map((option) => (
          <Button
            key={option.getTime()}
            type="button"
            size="medium"
            variant={option.getTime() === month.getTime() ? 'default' : 'ghost'}
            onClick={() => pickMonth(option)}
          >
            {format(
              option,
              option.getFullYear() === today.getFullYear()
                ? 'MMMM'
                : 'MMMM yyyy',
            )}
          </Button>
        ))}
      </Word>
      <Word
        label={copy.day}
        width="2em"
        open={open === 'day'}
        onOpenChange={toggle('day')}
        menuClassName="p-0"
        word={
          <>
            {dayOfMonth}
            <sup>{ordinal(dayOfMonth)}</sup>
          </>
        }
      >
        <Calendar
          mode="single"
          month={month}
          selected={value.day}
          startMonth={months[0]}
          endMonth={months[months.length - 1]}
          disabled={{ before: today }}
          onMonthChange={(next) => pickMonth(startOfMonth(next), true)}
          onSelect={(day) => {
            if (!day) return
            onChange({ ...value, day })
            setOpen(null)
          }}
        />
      </Word>
      <span className="font-semibold">{copy.at}</span>
      <Word
        label={copy.time}
        width="3.4em"
        open={open === 'time'}
        onOpenChange={toggle('time')}
        menuClassName="grid grid-cols-3 gap-1 p-2 sm:grid-cols-4"
        word={
          <>
            {clock(value.startMinutes)}
            <small>{half(value.startMinutes)}</small>
          </>
        }
      >
        {times.map((option) => (
          <Button
            key={option}
            type="button"
            size="medium"
            variant={option === value.startMinutes ? 'default' : 'ghost'}
            onClick={() => {
              onChange({ ...value, startMinutes: option })
              setOpen(null)
            }}
          >
            {clock(option)} {half(option)}
          </Button>
        ))}
      </Word>
    </div>
  )
}
