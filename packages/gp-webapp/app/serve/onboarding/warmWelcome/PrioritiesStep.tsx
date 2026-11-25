import { useEffect, useRef, useState } from 'react'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import { useConfetti } from './ConfettiLayer'
import { cx, Tap, vars } from './parts'
import {
  countWords,
  EntranceOffset,
  handoffClass,
  prefersReducedMotion,
  useEntranceOffset,
  useHandoff,
  useRise,
  Words,
} from './Reveal'
import { useDock } from './WarmWelcomeShell'
import {
  focusVerdict,
  WARM_WELCOME_COPY,
  type FirstWin,
  type FocusKind,
  type OfficeWords,
  type ResidentInterest,
} from './warmWelcomeConfig'

export interface FocusCard {
  key: string
  title: string
  residentInterest: ResidentInterest
  firstWin: FirstWin
}

// The tease holds the stage on its own before the real page.
const TEASE_MS = 2900
const DOT_FIRST_MS = 900
// "win" swells this long after it lands, and the words after it wait.
const PULSE_AFTER_MS = 400
const AFTER_WIN_WAIT_MS = 200
const WORD_STAGGER_MS = 55

const PILL_CLASS: Record<FirstWin, string> = {
  weeks: 'weeks',
  months: 'months',
  year_or_more: 'year',
}

// "Let's get another win under your belt." The word win swells once as it
// lands, a blue to red sweep runs through it, and confetti pops out of it.
const Title = (): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.priorities
  const offset = useEntranceOffset()
  const confetti = useConfetti()
  const winRef = useRef<HTMLSpanElement>(null)
  const [pulse, setPulse] = useState(false)
  const winAt = countWords(copy.titleLead)

  useEffect(() => {
    if (prefersReducedMotion()) return
    const timer = setTimeout(
      () => {
        setPulse(true)
        if (winRef.current) confetti.burst(winRef.current, 44)
      },
      offset + winAt * WORD_STAGGER_MS + PULSE_AFTER_MS,
    )
    return () => clearTimeout(timer)
  }, [offset, winAt, confetti])

  return (
    <h1 style={{ maxWidth: '20ch' }}>
      <Words wordDelay={(at) => (at > winAt ? AFTER_WIN_WAIT_MS : 0)}>
        {`${copy.titleLead} `}
        <span ref={winRef} className={cx('wi', pulse && 'pulse')}>
          {copy.titleAccent}
        </span>
        {` ${copy.titleTail}`}
      </Words>
    </h1>
  )
}

// Step 5: one thing to start with. A tease on its own, then the cards: each
// issue with how much residents care and how soon a first win could come,
// lined up so the cards can be compared at a glance. Picking one folds the
// intro away and brings up a short verdict and the button.
export const PrioritiesStep = ({
  cards,
  kind,
  place,
  words,
  searching,
  saving,
  picked,
  onPick,
  onNext,
}: {
  cards: FocusCard[]
  kind: FocusKind
  place: string | null
  words: OfficeWords
  // The search for local issues is still running and has found none yet.
  searching: boolean
  saving: boolean
  picked: string | null
  onPick: (key: string) => void
  onNext: () => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.priorities
  const stepOffset = useEntranceOffset()
  const [view, setView] = useState<'tease' | 'main'>('tease')
  const handoff = useHandoff(view)
  const { shown, entered } = handoff
  const offset = entered ? 0 : stepOffset
  const [verdictRun, setVerdictRun] = useState(0)
  const chosen = cards.find((card) => card.key === picked)
  const verdict = chosen
    ? focusVerdict(chosen.residentInterest, chosen.firstWin)
    : null

  useEffect(() => {
    const timer = setTimeout(
      () => setView('main'),
      prefersReducedMotion() ? 0 : stepOffset + TEASE_MS,
    )
    return () => clearTimeout(timer)
  }, [stepOffset])

  useDock(
    `priorities-${shown === 'main' && chosen ? 'picked' : shown}`,
    0,
    shown === 'main' && chosen
      ? [
          {
            key: 'start',
            label: copy.start,
            kind: 'primary',
            disabled: saving,
            onClick: onNext,
          },
        ]
      : [],
  )

  const lede = copy.lede(words)

  return (
    <div className="wrap center" style={{ gap: 22 }}>
      <EntranceOffset value={offset}>
        {shown === 'tease' && (
          <div className={cx('col center', handoffClass(handoff))}>
            <h1 className="tease" aria-label={copy.tease}>
              <Words>
                {copy.tease}
                <span className="dots" aria-hidden>
                  {[0, 1, 2].map((dot) => (
                    <i
                      key={dot}
                      style={vars({
                        '--k': dot,
                        '--dd': `${stepOffset + DOT_FIRST_MS}ms`,
                      })}
                    >
                      .
                    </i>
                  ))}
                </span>
              </Words>
            </h1>
          </div>
        )}
        {shown === 'main' && (
          <div
            className={cx('col center', handoffClass(handoff))}
            style={{ gap: 22, width: '100%' }}
          >
            <Title />
            <div className={cx('fold', chosen && 'off')}>
              <div>
                <p className="lede" style={{ maxWidth: '52ch' }}>
                  <Words
                    delay={600}
                    index={
                      countWords(copy.titleLead) +
                      1 +
                      countWords(copy.titleTail)
                    }
                  >
                    {lede}
                  </Words>
                </p>
                <Caption>
                  {cards.length > 0
                    ? copy.caption(kind, place)
                    : searching
                      ? copy.searching
                      : ''}
                </Caption>
              </div>
            </div>
            <div
              className="picks"
              role="radiogroup"
              aria-label={copy.group(kind)}
            >
              {cards.map((card, index) => (
                <Tap
                  key={card.key}
                  className={cx('pk ui', picked === card.key && 'on')}
                  role="radio"
                  aria-checked={picked === card.key}
                  style={vars({ '--d': `${offset + 1200 + 120 * index}ms` })}
                  onClick={() => {
                    if (picked && picked !== card.key) {
                      setVerdictRun((run) => run + 1)
                    }
                    onPick(card.key)
                  }}
                >
                  <span className="head">
                    <span className="t">{card.title}</span>
                  </span>
                  <span className="facts">
                    <span className="row">
                      <span className="k">{copy.interest}</span>
                      <b>{copy.interestWord[card.residentInterest]}</b>
                    </span>
                    <span className="row">
                      <span className="k">{copy.firstWin}</span>
                      <span className={`pill ${PILL_CLASS[card.firstWin]}`}>
                        {copy.firstWinWord[card.firstWin]}
                      </span>
                    </span>
                  </span>
                </Tap>
              ))}
            </div>
            <div className={cx('fold', !chosen && 'off')}>
              <div>
                <div
                  key={verdictRun}
                  className={cx('verdict', verdictRun > 0 && 'swap')}
                  role="status"
                >
                  <span className="ic">
                    <SparklesIcon className="i" aria-hidden />
                  </span>
                  <p>
                    <b>{verdict?.title}</b> <span>{verdict?.text}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </EntranceOffset>
    </div>
  )
}

const Caption = ({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element => (
  <p className="cap ui" style={useRise(1050)}>
    {children}
  </p>
)
