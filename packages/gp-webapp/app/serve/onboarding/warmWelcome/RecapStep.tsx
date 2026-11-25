import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CalendarIcon,
  FileTextIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import { cn } from '@styleguide/lib/utils'
import { useConfetti } from './ConfettiLayer'
import type { FirstMeeting } from './firstMeeting'
import {
  countWords,
  prefersReducedMotion,
  Rise,
  useEntranceOffset,
  Words,
} from './Reveal'
import { useDock } from './WarmWelcomeShell'
import { WARM_WELCOME_COPY, type RecapLine } from './warmWelcomeConfig'

const NEXT_AT_MS = 1900
const CARD_AT_MS = 3000
const FIRST_ROW_AT_MS = 3600
const ROW_EVERY_MS = 1800
const BURST_AFTER_MS = 550
const BURST_PIECES = 44

// One thing that happens next. Its icon bursts as the row lands.
const RecapRow = ({
  icon,
  line,
  delay,
}: {
  icon: ReactNode
  line: RecapLine
  delay: number
}): React.JSX.Element => {
  const offset = useEntranceOffset()
  const confetti = useConfetti()
  const iconRef = useRef<HTMLSpanElement>(null)
  const [landed, setLanded] = useState(false)

  useEffect(() => {
    if (prefersReducedMotion()) return
    const timer = setTimeout(
      () => {
        setLanded(true)
        if (iconRef.current) confetti.burst(iconRef.current, BURST_PIECES)
      },
      offset + delay + BURST_AFTER_MS,
    )
    return () => clearTimeout(timer)
  }, [offset, delay, confetti])

  return (
    <Rise
      delay={delay}
      className="flex items-center gap-3.5 border-t border-base-border px-4 py-3.5 text-left first:border-t-0"
    >
      <span
        ref={iconRef}
        className={cn(
          'flex size-10 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary',
          landed && 'ww-boom',
        )}
      >
        {icon}
      </span>
      <p className="ww-lede flex-1">
        {line.lead}
        {line.oneSentence ? ' ' : <br />}
        <b className="font-semibold">{line.strong}</b>
      </p>
    </Rise>
  )
}

// The last step: what happens next, then Done.
export const RecapStep = ({
  firstName,
  meeting,
  readyDay,
  saving,
  onDone,
}: {
  firstName: string | null
  meeting: FirstMeeting | null
  // The day the first briefing is promised for, when there is one.
  readyDay: Date | null
  saving: boolean
  onDone: () => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.recap
  const title = copy.title(firstName)
  const confetti = useConfetti()

  // The pops pile up on the footer and fade when the step is left.
  useEffect(() => () => confetti.clear(), [confetti])
  const rows: { key: string; icon: ReactNode; line: RecapLine }[] = [
    meeting && readyDay
      ? {
          key: 'briefing',
          icon: <FileTextIcon className="size-[18px]" aria-hidden />,
          line: copy.briefing(meeting, readyDay),
        }
      : {
          key: 'meeting',
          icon: <CalendarIcon className="size-[18px]" aria-hidden />,
          line: meeting ? copy.meeting(meeting) : copy.noMeeting,
        },
    {
      key: 'serve',
      icon: <SparklesIcon className="size-[18px]" aria-hidden />,
      line: copy.serve,
    },
  ]

  useDock('recap', FIRST_ROW_AT_MS + ROW_EVERY_MS * rows.length, [
    {
      key: 'done',
      label: copy.done,
      kind: 'primary',
      onClick: onDone,
      loading: saving,
    },
  ])

  return (
    <div className="flex w-full max-w-[960px] flex-col items-center gap-6 text-center">
      <h1 className="ww-title">
        <Words>{title}</Words>
      </h1>
      <p className="ww-title">
        <Words delay={NEXT_AT_MS} index={countWords(title)}>
          {copy.next}
        </Words>
      </p>
      <Rise
        delay={CARD_AT_MS}
        className="flex w-full max-w-[540px] flex-col rounded-[14px] bg-card px-1 py-1.5 shadow-lg"
      >
        {rows.map((row, index) => (
          <RecapRow
            key={row.key}
            icon={row.icon}
            line={row.line}
            delay={FIRST_ROW_AT_MS + ROW_EVERY_MS * index}
          />
        ))}
      </Rise>
    </div>
  )
}
