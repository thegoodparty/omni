import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format, isBefore } from 'date-fns'
import {
  clockParts,
  clockTime,
  daysInMonth,
  MEETING_TIMES,
  ordinal,
  upcomingMonths,
} from './firstMeeting'
import { cx, Tap, vars } from './parts'
import { useShell } from './WarmWelcomeShell'
import { WARM_WELCOME_COPY } from './warmWelcomeConfig'

export interface PickedDate {
  day: Date
  startMinutes: number
}

type Part = 'month' | 'day' | 'time'

const SHEET_QUERY = '(max-width:480px)'

// The widest each word can get, so the sentence never shifts as they change.
const WIDEST_DAYS = [1, 21, 31, 29, 28]

// One word's menu: a small card right under the word, or, on a phone, a
// sheet pinned to the bottom of the screen. A menu that would run off the
// bottom of the stage opens upward.
const Menu = ({
  kind,
  label,
  open,
  children,
}: {
  kind: 'months' | 'days' | 'times'
  label: string
  open: boolean
  children: React.ReactNode
}): React.JSX.Element => {
  const shell = useShell()
  const ref = useRef<HTMLDivElement>(null)
  const [up, setUp] = useState(false)
  const [sheet, setSheet] = useState(false)

  useEffect(() => {
    const query = window.matchMedia?.(SHEET_QUERY)
    if (!query) return
    const read = (): void => setSheet(query.matches)
    read()
    query.addEventListener('change', read)
    return () => query.removeEventListener('change', read)
  }, [])

  useLayoutEffect(() => {
    const menu = ref.current
    const word = menu?.parentElement
    const stage = menu?.closest('.stage')
    if (!open || sheet || !menu || !word || !stage) {
      setUp(false)
      return
    }
    const menuBox = menu.getBoundingClientRect()
    const stageBox = stage.getBoundingClientRect()
    const wordBox = word.getBoundingClientRect()
    setUp(
      menuBox.bottom > stageBox.bottom - 8 &&
        wordBox.top - stageBox.top > stageBox.bottom - wordBox.bottom,
    )
  }, [open, sheet])

  const menu = (
    <div
      ref={ref}
      className={cx('menu', kind, open && 'open', up && 'up')}
      role="group"
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
  return sheet && open && shell ? createPortal(menu, shell) : menu
}

// The date picker reads as a sentence, "January 7th at 7:00 pm". Each part
// is a word with a dotted underline; tapping it opens its menu.
export const DateSentence = ({
  value,
  today,
  onChange,
}: {
  value: PickedDate
  today: Date
  onChange: (next: PickedDate) => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.meeting
  const [open, setOpen] = useState<Part | null>(null)
  const sentenceRef = useRef<HTMLDivElement>(null)
  const [widths, setWidths] = useState<Record<string, string>>({})
  const [months] = useState(() => upcomingMonths(today))
  const [times] = useState(() =>
    MEETING_TIMES.includes(value.startMinutes)
      ? MEETING_TIMES
      : [...MEETING_TIMES, value.startMinutes].sort((a, b) => a - b),
  )
  const month = new Date(value.day.getFullYear(), value.day.getMonth(), 1)
  const [clock, half] = clockParts(value.startMinutes)

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(null)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    const sentence = sentenceRef.current
    if (!sentence) return
    const measure = (): void => {
      const probe = document.createElement('span')
      probe.style.cssText =
        'position:absolute;visibility:hidden;white-space:nowrap;font:inherit;padding:0 .04em'
      sentence.appendChild(probe)
      const widest = (texts: string[]): number =>
        texts.reduce((max, html) => {
          probe.innerHTML = html
          return Math.max(max, probe.offsetWidth)
        }, 0)
      const monthWidth = widest(months.map((each) => format(each, 'MMMM')))
      const dayWidth = widest(
        WIDEST_DAYS.map(
          (day) => `${day}<span class="sfx">${ordinal(day)}</span>`,
        ),
      )
      const timeWidth = widest(
        times.map((minutes) => {
          const [text, suffix] = clockParts(minutes)
          return `${text}<span class="ap">${suffix}</span>`
        }),
      )
      sentence.removeChild(probe)
      if (monthWidth > 0 && dayWidth > 0 && timeWidth > 0) {
        setWidths({
          '--mw': `${monthWidth}px`,
          '--dw': `${dayWidth}px`,
          '--tw': `${timeWidth}px`,
        })
      }
    }
    measure()
    void document.fonts?.ready.then(measure)
  }, [months, times])

  const toggle = (part: Part) => (event: React.MouseEvent) => {
    event.stopPropagation()
    setOpen((current) => (current === part ? null : part))
  }

  const pickMonth = (next: Date): void => {
    const day = Math.min(value.day.getDate(), daysInMonth(next))
    onChange({
      ...value,
      day: new Date(next.getFullYear(), next.getMonth(), day),
    })
    setOpen(null)
  }

  return (
    <div
      className="bigdate"
      aria-label={copy.pickLabel}
      ref={sentenceRef}
      style={vars(widths)}
    >
      <span className="word m">
        <Tap
          aria-label={copy.month}
          aria-haspopup="true"
          aria-expanded={open === 'month'}
          onClick={toggle('month')}
        >
          {format(value.day, 'MMMM')}
        </Tap>
        <Menu kind="months" label={copy.months} open={open === 'month'}>
          {months.map((each) => (
            <Tap
              key={each.getTime()}
              className={each.getTime() === month.getTime() ? 'on' : undefined}
              onClick={() => pickMonth(each)}
            >
              {format(each, 'MMMM')}
            </Tap>
          ))}
        </Menu>
      </span>
      <span className="word d">
        <Tap
          aria-label={copy.day}
          aria-haspopup="true"
          aria-expanded={open === 'day'}
          onClick={toggle('day')}
        >
          {value.day.getDate()}
          <span className="sfx">{ordinal(value.day.getDate())}</span>
        </Tap>
        <Menu kind="days" label={copy.days} open={open === 'day'}>
          {Array.from({ length: daysInMonth(month) }, (_, index) => {
            const day = new Date(
              month.getFullYear(),
              month.getMonth(),
              index + 1,
            )
            return (
              <Tap
                key={index}
                className={index + 1 === value.day.getDate() ? 'on' : undefined}
                disabled={isBefore(day, today)}
                onClick={() => {
                  onChange({ ...value, day })
                  setOpen(null)
                }}
              >
                {index + 1}
              </Tap>
            )
          })}
        </Menu>
      </span>
      <span className="at">{copy.at}</span>
      <span className="word t">
        <Tap
          aria-label={copy.time}
          aria-haspopup="true"
          aria-expanded={open === 'time'}
          onClick={toggle('time')}
        >
          {clock}
          <span className="ap">{half}</span>
        </Tap>
        <Menu kind="times" label={copy.times} open={open === 'time'}>
          {times.map((minutes) => (
            <Tap
              key={minutes}
              className={minutes === value.startMinutes ? 'on' : undefined}
              onClick={() => {
                onChange({ ...value, startMinutes: minutes })
                setOpen(null)
              }}
            >
              {clockTime(minutes)}
            </Tap>
          ))}
        </Menu>
      </span>
    </div>
  )
}
