import { useEffect, useRef, useState } from 'react'
import { useConfetti } from './ConfettiLayer'
import {
  countWords,
  prefersReducedMotion,
  useEntranceOffset,
  Words,
} from './Reveal'
import { cx, vars } from './parts'
import { useDock } from './WarmWelcomeShell'
import { WARM_WELCOME_COPY } from './warmWelcomeConfig'

// The design's colors for the two numbers: the brand's red, then its blue.
const VOTES_COLOR = '#dc1438'
const SERVE_COLOR = '#1e63ec'

const POUR_AT_MS = 900
const CARD_AT_MS = 1300
const ZEROS_AT_MS = 1750
const COUNT_AT_MS = 2450
const COUNT_MS = 1300
// From one number landing to the next one starting: the swap out, the swap
// in with fresh zeros, then the count.
const SWAP_OUT_AFTER_MS = 4900 - COUNT_AT_MS
const SWAP_IN_AFTER_MS = 5250 - COUNT_AT_MS
const NEXT_COUNT_AFTER_MS = 6050 - COUNT_AT_MS
// After the last number starts counting: when the lede and the button come.
const LEDE_AFTER_MS = 7600 - 6050
const BUTTON_AFTER_MS = 8500 - 6050

interface Tally {
  label: string
  value: number
  color: string
}

// Zero-padded to the width of the final number, commas included, so the
// digits hold their places while they count: 29,571 starts as 00,000.
const padded = (value: number, digits: number): string =>
  String(value)
    .padStart(digits, '0')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')

type Phase = 'wait' | 'zeros' | 'counting' | 'landed'

// One card: it slides in once, then its label and number change in place.
// Each number's zeros arrive one by one, it counts up, and it pops as it
// lands with a small burst of confetti.
const Tallies = ({ tallies }: { tallies: Tally[] }): React.JSX.Element => {
  const offset = useEntranceOffset()
  const confetti = useConfetti()
  const slotRef = useRef<HTMLDivElement>(null)
  const numberRef = useRef<HTMLSpanElement>(null)
  const [reduced] = useState(prefersReducedMotion)
  const last = tallies.length - 1
  const [at, setAt] = useState(reduced ? last : 0)
  const [cardIn, setCardIn] = useState(reduced)
  const [swapping, setSwapping] = useState(false)
  const [phase, setPhase] = useState<Phase>(reduced ? 'landed' : 'wait')
  const [shown, setShown] = useState(reduced ? (tallies[last]?.value ?? 0) : 0)

  useEffect(() => {
    if (reduced) return
    const timers: ReturnType<typeof setTimeout>[] = []
    let frame = 0
    const later = (ms: number, run: () => void): void => {
      timers.push(setTimeout(run, offset + ms))
    }
    const count = (target: number): void => {
      setPhase('counting')
      const startedAt = performance.now()
      const tick = (now: number): void => {
        const progress = Math.min(1, (now - startedAt) / COUNT_MS)
        setShown(Math.round(target * (1 - Math.pow(1 - progress, 3))))
        if (progress < 1) {
          frame = requestAnimationFrame(tick)
          return
        }
        setPhase('landed')
        if (numberRef.current) confetti.burst(numberRef.current)
      }
      frame = requestAnimationFrame(tick)
    }
    later(CARD_AT_MS, () => setCardIn(true))
    // Once the card has arrived, confetti can settle on its top edge.
    later(ZEROS_AT_MS, () => {
      if (slotRef.current) confetti.addSurface(slotRef.current)
      setPhase('zeros')
    })
    tallies.forEach((tally, index) => {
      const base = COUNT_AT_MS + index * NEXT_COUNT_AFTER_MS
      if (index > 0) {
        const from = COUNT_AT_MS + (index - 1) * NEXT_COUNT_AFTER_MS
        later(from + SWAP_OUT_AFTER_MS, () => setSwapping(true))
        later(from + SWAP_IN_AFTER_MS, () => {
          setAt(index)
          setShown(0)
          setPhase('zeros')
          setSwapping(false)
        })
      }
      later(base, () => count(tally.value))
    })
    return () => {
      timers.forEach(clearTimeout)
      cancelAnimationFrame(frame)
    }
  }, [reduced, offset, tallies, confetti])

  const tally = tallies[at]
  if (!tally) return <></>
  const digits = String(tally.value).length

  return (
    <div className="slot" ref={slotRef}>
      <div className={cx('gcard pcard', cardIn && 'in')}>
        <span className={cx('plabel', swapping && 'swap')}>{tally.label}</span>
        <span
          ref={numberRef}
          className={cx(
            'bignum',
            swapping && 'swap',
            phase === 'landed' && !reduced && 'pop',
          )}
          style={{ color: tally.color }}
          role="img"
          aria-label={tally.value.toLocaleString('en-US')}
        >
          {phase === 'wait' && <span aria-hidden>&nbsp;</span>}
          {phase === 'zeros' &&
            padded(0, digits)
              .split('')
              .map((char, index) => (
                <span
                  key={index}
                  aria-hidden
                  className="z"
                  style={vars({ '--i': index })}
                >
                  {char}
                </span>
              ))}
          {(phase === 'counting' || phase === 'landed') && (
            <span aria-hidden>{padded(shown, digits)}</span>
          )}
        </span>
      </div>
    </div>
  )
}

// Step 1: the win. The people who voted for them, then everyone they serve
// now. A winner with no vote count on file sees the one number.
export const WonStep = ({
  firstName,
  place,
  votes,
  population,
  onNext,
}: {
  firstName: string | null
  place: string | null
  votes: number | null
  population: number | null
  onNext: () => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.won
  const title = copy.title(firstName)
  const offset = useEntranceOffset()
  const confetti = useConfetti()
  const [tallies] = useState((): Tally[] => [
    ...(votes !== null && votes > 0
      ? [{ label: copy.votesLabel, value: votes, color: VOTES_COLOR }]
      : []),
    ...(population !== null && population > 0
      ? [{ label: copy.serveLabel, value: population, color: SERVE_COLOR }]
      : []),
  ])
  const lastCountAt =
    COUNT_AT_MS + Math.max(0, tallies.length - 1) * NEXT_COUNT_AFTER_MS

  // A beat, then red, white and blue pour from the top.
  useEffect(() => {
    const timer = setTimeout(() => confetti.pour(), POUR_AT_MS)
    return () => clearTimeout(timer)
  }, [confetti])

  useDock(
    'won',
    offset + (tallies.length > 0 ? lastCountAt + BUTTON_AFTER_MS : 2300),
    [{ key: 'next', label: copy.next, kind: 'primary', onClick: onNext }],
  )

  return (
    <div className="won-wrap">
      <h1>
        <Words stagger={210} duration={900} ripple>
          {title}
        </Words>
      </h1>
      {tallies.length > 0 && <Tallies tallies={tallies} />}
      <p className="lede" style={{ maxWidth: '40ch' }}>
        <Words
          delay={tallies.length > 0 ? lastCountAt + LEDE_AFTER_MS : 1500}
          index={countWords(title)}
        >
          {copy.lede(place)}
        </Words>
      </p>
    </div>
  )
}
