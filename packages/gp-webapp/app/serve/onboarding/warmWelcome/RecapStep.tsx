import { useEffect, useRef, useState } from 'react'
import {
  CalendarIcon,
  ChevronRightIcon,
  EarIcon,
  FileIcon,
  FlagIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import { useConfetti } from './ConfettiLayer'
import { cx, Tap, vars } from './parts'
import {
  countWords,
  prefersReducedMotion,
  useEntranceOffset,
  useRise,
  Words,
} from './Reveal'
import { useDock } from './WarmWelcomeShell'
import { WARM_WELCOME_COPY, type RecapLine } from './warmWelcomeConfig'

// The rows land a beat apart; each icon bursts a moment after its row.
const FIRST_ROW_MS = 3600
const ROW_GAP_MS = 1800
const BOOM_AFTER_MS = 550

export interface RecapRow {
  key: 'meeting' | 'focus' | 'panel'
  icon: 'file' | 'calendar' | 'flag' | 'spark' | 'ear'
  line: RecapLine
  // The Civic Panel row, while it is still an offer: a chevron back to it.
  onOpen?: () => void
}

const ICONS = {
  file: FileIcon,
  calendar: CalendarIcon,
  flag: FlagIcon,
  spark: SparklesIcon,
  ear: EarIcon,
}

const Row = ({ row, at }: { row: RecapRow; at: number }): React.JSX.Element => {
  const offset = useEntranceOffset()
  const confetti = useConfetti()
  const iconRef = useRef<HTMLSpanElement>(null)
  const [boom, setBoom] = useState(false)
  const delay = FIRST_ROW_MS + ROW_GAP_MS * at
  const Icon = ICONS[row.icon]

  useEffect(() => {
    if (prefersReducedMotion()) return
    const timer = setTimeout(
      () => {
        setBoom(true)
        if (iconRef.current) confetti.burst(iconRef.current, 44)
      },
      offset + delay + BOOM_AFTER_MS,
    )
    return () => clearTimeout(timer)
  }, [offset, delay, confetti])

  return (
    <div className="rline ui" style={vars({ '--d': `${offset + delay}ms` })}>
      <span className={cx('ic', boom && 'boom')} ref={iconRef}>
        <Icon className="i" aria-hidden />
      </span>
      <p>
        {row.line.lead}
        {row.line.oneSentence ? ' ' : <br />}
        <b>{row.line.strong}</b>
        {row.line.end}
      </p>
      {row.key === 'panel' && (
        <Tap
          className={cx('mbtn go', !row.onOpen && 'out')}
          aria-label={WARM_WELCOME_COPY.recap.panelOpen}
          tabIndex={row.onOpen ? undefined : -1}
          aria-hidden={row.onOpen ? undefined : true}
          onClick={row.onOpen}
        >
          <ChevronRightIcon className="i" aria-hidden />
        </Tap>
      )}
    </div>
  )
}

// Step 6: what happens next, then Done. One white card fades in and its
// rows land in it a beat apart.
export const RecapStep = ({
  firstName,
  rows,
  saving,
  onDone,
}: {
  firstName: string | null
  rows: RecapRow[]
  saving: boolean
  onDone: () => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.recap
  const offset = useEntranceOffset()
  const title = copy.title(firstName)
  const cardRise = useRise(3000)
  // The offer row gets a longer look before Done arrives.
  const offering = rows.some((row) => row.onOpen)

  useDock(
    'recap',
    offset +
      FIRST_ROW_MS +
      ROW_GAP_MS * rows.length +
      (offering ? ROW_GAP_MS : 0),
    [
      {
        key: 'done',
        label: copy.done,
        kind: 'primary',
        disabled: saving,
        onClick: onDone,
      },
    ],
  )

  return (
    <div className="wrap center" style={{ gap: 24 }}>
      <h1>
        <Words>{title}</Words>
      </h1>
      <p className="lede big">
        <Words delay={1900} index={countWords(title)}>
          {copy.next}
        </Words>
      </p>
      <div className="recap ui" style={cardRise}>
        {rows.map((row, at) => (
          <Row key={row.key} row={row} at={at} />
        ))}
      </div>
    </div>
  )
}
