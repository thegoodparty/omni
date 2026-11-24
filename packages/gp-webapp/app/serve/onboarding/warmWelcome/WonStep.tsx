import { useEffect, useState, type CSSProperties } from 'react'
import { ConfettiBurst } from '@styleguide'
import { cn } from '@styleguide/lib/utils'
import { ConfettiField } from 'app/dashboard/pro-upgrade/components/ConfettiField'
import {
  countWords,
  prefersReducedMotion,
  useEntranceOffset,
  Words,
} from './Reveal'
import { useDock } from './WarmWelcomeShell'
import { WARM_WELCOME_COPY } from './warmWelcomeConfig'

const CARD_AT_MS = 1300
const ZEROS_AT_MS = 1750
const COUNT_AT_MS = 2450
const COUNT_MS = 1300

// Zero-padded to the width of the final number, commas included, so the
// digits hold their places while they count: 29,571 starts as 00,000.
const padded = (value: number, digits: number): string =>
  String(value)
    .padStart(digits, '0')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// The number of people the official now serves. Its zeros arrive one by
// one, it counts up, and it pops as it lands.
const ServeCount = ({
  population,
}: {
  population: number
}): React.JSX.Element => {
  const offset = useEntranceOffset()
  const [reduced] = useState(prefersReducedMotion)
  const [phase, setPhase] = useState<'wait' | 'zeros' | 'counting' | 'landed'>(
    reduced ? 'landed' : 'wait',
  )
  const [shown, setShown] = useState(reduced ? population : 0)
  const digits = String(population).length

  useEffect(() => {
    if (reduced) return
    let frame = 0
    const zeros = setTimeout(() => setPhase('zeros'), offset + ZEROS_AT_MS)
    const count = setTimeout(() => {
      setPhase('counting')
      const startedAt = performance.now()
      const tick = (now: number): void => {
        const progress = Math.min(1, (now - startedAt) / COUNT_MS)
        setShown(Math.round(population * (1 - Math.pow(1 - progress, 3))))
        if (progress < 1) frame = requestAnimationFrame(tick)
        else setPhase('landed')
      }
      frame = requestAnimationFrame(tick)
    }, offset + COUNT_AT_MS)
    return () => {
      clearTimeout(zeros)
      clearTimeout(count)
      cancelAnimationFrame(frame)
    }
  }, [reduced, offset, population])

  return (
    <div
      className="ww-rise flex min-h-[220px] w-full max-w-[520px] flex-col items-center justify-center gap-2.5 rounded-[14px] bg-card px-5 pt-6 pb-5 shadow-lg"
      style={{ '--d': `${offset + CARD_AT_MS}ms` } as CSSProperties}
    >
      <span className="ww-heading">{WARM_WELCOME_COPY.won.serveLabel}</span>
      <span className="relative">
        <span
          className={cn(
            'ww-number block',
            phase === 'landed' && 'ww-number-pop',
          )}
          aria-label={population.toLocaleString('en-US')}
          role="img"
        >
          {phase === 'wait' && <span aria-hidden>&nbsp;</span>}
          {phase === 'zeros' &&
            padded(0, digits)
              .split('')
              .map((char, index) => (
                <span
                  key={index}
                  aria-hidden
                  className="ww-zero"
                  style={{ '--i': index } as CSSProperties}
                >
                  {char}
                </span>
              ))}
          {(phase === 'counting' || phase === 'landed') && (
            <span aria-hidden>{padded(shown, digits)}</span>
          )}
        </span>
        <ConfettiBurst
          aria-hidden
          play={phase === 'landed' && !reduced}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        />
      </span>
    </div>
  )
}

// Step 1: the win, and who they serve now.
export const WonStep = ({
  firstName,
  place,
  population,
  onNext,
}: {
  firstName: string | null
  place: string | null
  population: number | null
  onNext: () => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.won
  const title = copy.title(firstName)
  const counted = population !== null && population > 0

  useDock('won', counted ? 5200 : 2300, [
    { key: 'next', label: copy.next, kind: 'primary', onClick: onNext },
  ])

  return (
    <>
      <div className="pointer-events-none absolute inset-0 motion-reduce:hidden">
        <ConfettiField />
      </div>
      <div className="relative flex w-full max-w-[820px] flex-col items-center gap-7 text-center">
        <h1 className="ww-display">
          <Words stagger={210} duration={900} ripple>
            {title}
          </Words>
        </h1>
        {counted && <ServeCount population={population} />}
        <p className="ww-lede max-w-[40ch] text-muted-foreground">
          <Words delay={counted ? 4300 : 1500} index={countWords(title)}>
            {copy.lede(place)}
          </Words>
        </p>
      </div>
    </>
  )
}
