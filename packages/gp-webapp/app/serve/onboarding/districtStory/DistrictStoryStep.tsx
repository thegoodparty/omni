import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@styleguide/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@styleguide'
import { InfoIcon, RefreshIcon } from '@styleguide/components/ui/icons'
import { answersNeeded } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import { onboardingDistrictStatsQueryOptions } from 'app/onboarding/components/VoterDemographicsStep'
import {
  SERVE_STORY_COPY,
  type ServeStoryStepId,
  type ServeStoryTitle,
} from '../serveOnboardingConfig'
import { DistrictStoryMap } from './DistrictStoryMap'
import {
  buildAbstractDots,
  buildDistrictDots,
  residentsPerDot,
  type DistrictDots,
  type DistrictMapMode,
  type LatLng,
} from './districtDots'

// How long the story waits for district data before it tells the story on
// the stand-in map instead. The map is never swapped once it is drawn.
export const DISTRICT_DATA_WAIT_MS = 8_000
const COUNT_UP_MS = 1_000

const MODE_FOR_STEP: Record<ServeStoryStepId, DistrictMapMode> = {
  'story-represent': 'all',
  'story-loudest': 'dim',
  'story-sample': 'sample',
  'story-grow': 'grow',
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

// The ids the endpoint returns are dropped here, so the story holds bare
// coordinates and nothing that names a person.
export const districtPointsQueryKey = (eoId: string | undefined) =>
  ['serve-onboarding-district-points', eoId] as const

const useDistrictPoints = (
  eoId: string | undefined,
  enabled: boolean,
): { points: LatLng[] | null; settled: boolean } => {
  const query = useQuery({
    queryKey: districtPointsQueryKey(eoId),
    enabled,
    queryFn: () =>
      clientRequest('POST /v1/contacts/points', { filters: {} }).then((res) =>
        res.data.points.map(({ lat, lng }) => ({ lat, lng })),
      ),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  return {
    points: query.data ?? null,
    settled: !enabled || !query.isPending,
  }
}

export interface DistrictStoryStepProps {
  step: ServeStoryStepId
  eoId?: string
  positionId?: string
  place?: string
  introPlayed: boolean
  onIntroPlayed: () => void
}

// The four story steps share this one component, so its map stays mounted
// and changes mode instead of redrawing on each step.
export const DistrictStoryStep = ({
  step,
  eoId,
  positionId,
  place,
  introPlayed,
  onIntroPlayed,
}: DistrictStoryStepProps): React.JSX.Element => {
  const hasDistrict = Boolean(eoId && positionId)
  const { points, settled: pointsSettled } = useDistrictPoints(
    eoId,
    hasDistrict,
  )
  const stats = useQuery(
    onboardingDistrictStatsQueryOptions({ orgPositionId: positionId }),
  )
  const statsSettled = !positionId || !stats.isPending

  useEffect(() => {
    if (!stats.error) return
    reportErrorToSentry(stats.error, { context: 'serveOnboarding.storyStats' })
  }, [stats.error])

  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), DISTRICT_DATA_WAIT_MS)
    return () => clearTimeout(timer)
  }, [])

  const [model, setModel] = useState<DistrictDots | null>(null)
  const [population, setPopulation] = useState<number | null>(null)
  const ready = model !== null
  useEffect(() => {
    if (ready) return
    if (!(pointsSettled && statsSettled) && !timedOut) return
    const known = stats.data?.districtPopulation ?? null
    const sampleSize = answersNeeded(known)
    setPopulation(known)
    setModel(
      (points && buildDistrictDots(points, sampleSize)) ??
        buildAbstractDots(sampleSize),
    )
  }, [
    ready,
    pointsSettled,
    statsSettled,
    timedOut,
    points,
    stats.data?.districtPopulation,
  ])

  if (!model) {
    return (
      <div
        className="flex min-h-[40vh] items-center justify-center"
        data-testid="district-story-loading"
      >
        <LoaderCircle className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <StoryContent
      step={step}
      model={model}
      population={population}
      place={place?.trim() || SERVE_STORY_COPY.represent.defaultPlace}
      introPlayed={introPlayed}
      onIntroPlayed={onIntroPlayed}
    />
  )
}

const StoryContent = ({
  step,
  model,
  population,
  place,
  introPlayed,
  onIntroPlayed,
}: {
  step: ServeStoryStepId
  model: DistrictDots
  population: number | null
  place: string
  introPlayed: boolean
  onIntroPlayed: () => void
}): React.JSX.Element => {
  const [reduced] = useState(prefersReducedMotion)
  const [intro] = useState(
    !reduced && !introPlayed && step === 'story-represent',
  )
  // The counter runs once, with the intro. Coming back to the first step
  // shows the number as it ends.
  const [countUp, setCountUp] = useState(intro)
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:items-center md:gap-10">
      <div className="order-2 md:order-1">
        <StoryText
          step={step}
          population={population}
          dots={model.dots.length}
          place={place}
          countUp={countUp}
          onCountStarted={() => setCountUp(false)}
        />
      </div>
      <div
        className={cn(
          'order-1 overflow-hidden rounded-xl border border-base-border bg-card md:order-2',
          !model.camera && 'p-3 sm:p-4',
        )}
      >
        <DistrictStoryMap
          model={model}
          mode={MODE_FOR_STEP[step]}
          animate={!reduced}
          intro={intro}
          onIntroDone={onIntroPlayed}
        />
      </div>
    </div>
  )
}

const useCountUp = (target: number, runOnMount: boolean): number => {
  const [run] = useState(runOnMount)
  const [value, setValue] = useState(run ? 0 : target)
  useEffect(() => {
    if (!run) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / COUNT_UP_MS)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(target * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, run])
  return value
}

const TITLE_CLASS =
  'text-3xl leading-tight font-semibold tracking-tight text-foreground md:text-4xl'

// The sample headline is the longest, so it steps down on a phone. 24px is
// the floor; at 390px it still wraps to three lines (two needs ~22px).
const LONG_TITLE_CLASS =
  'text-2xl leading-tight font-semibold tracking-tight text-foreground md:text-4xl'

const Title = ({
  title,
  accentClass,
  accent,
  long = false,
}: {
  title: ServeStoryTitle
  accentClass: string
  accent?: React.ReactNode
  long?: boolean
}): React.JSX.Element => (
  <h1
    className={long ? LONG_TITLE_CLASS : TITLE_CLASS}
    style={{ fontFamily: 'var(--font-geist)' }}
  >
    {title.lead} <span className={accentClass}>{accent ?? title.accent}</span>
    {/^[,.]/.test(title.tail) ? '' : ' '}
    {title.tail}
  </h1>
)

const Description = ({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element => (
  <p className="mt-4 text-base leading-relaxed text-muted-foreground">
    {children}
  </p>
)

// Opens on hover for a mouse, and on tap, Enter or Space like any button.
const AnswersInfo = ({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element => {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex translate-y-0.5 items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          onMouseEnter={() => setOpen(true)}
          // A click after the hover already opened it would toggle it shut.
          onClick={(event) => {
            event.preventDefault()
            setOpen(true)
          }}
          onMouseLeave={() => setOpen(false)}
        >
          <InfoIcon className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-sm leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  )
}

const RepresentText = ({
  population,
  dots,
  place,
  countUp,
  onCountStarted,
}: {
  population: number
  dots: number
  place: string
  countUp: boolean
  onCountStarted: () => void
}): React.JSX.Element => {
  const shown = useCountUp(population, countUp)
  const [started] = useState(countUp)
  useEffect(() => {
    if (started) onCountStarted()
  }, [started, onCountStarted])
  const copy = SERVE_STORY_COPY.represent
  const final = population.toLocaleString('en-US')
  return (
    <>
      <Title
        title={copy.title(final)}
        accentClass="text-primary"
        accent={
          <>
            <span aria-hidden="true" className="tabular-nums">
              {shown.toLocaleString('en-US')}
            </span>
            <span className="sr-only">{final}</span>
          </>
        }
      />
      <Description>
        {copy.description(residentsPerDot(population, dots), place)}
      </Description>
    </>
  )
}

const StoryText = ({
  step,
  population,
  dots,
  place,
  countUp,
  onCountStarted,
}: {
  step: ServeStoryStepId
  population: number | null
  dots: number
  place: string
  countUp: boolean
  onCountStarted: () => void
}): React.JSX.Element => {
  if (step === 'story-represent') {
    const copy = SERVE_STORY_COPY.represent
    if (population && population > 0) {
      return (
        <RepresentText
          population={population}
          dots={dots}
          place={place}
          countUp={countUp}
          onCountStarted={onCountStarted}
        />
      )
    }
    return (
      <>
        <h1 className={TITLE_CLASS} style={{ fontFamily: 'var(--font-geist)' }}>
          {copy.titleWithoutCount}
        </h1>
        <Description>{copy.descriptionWithoutCount(place)}</Description>
      </>
    )
  }

  if (step === 'story-loudest') {
    const copy = SERVE_STORY_COPY.loudest
    return (
      <>
        <Title title={copy.title} accentClass="text-warning" />
        <Description>{copy.description}</Description>
        <div className="mt-6 flex flex-wrap items-center gap-5 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-warning" />
            {copy.heardFrom}
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-muted-foreground/55" />
            {copy.notHeardFrom}
          </span>
        </div>
      </>
    )
  }

  if (step === 'story-sample') {
    const copy = SERVE_STORY_COPY.sample
    const answers = answersNeeded(population)
    return (
      <>
        <Title title={copy.title(answers)} accentClass="text-primary" long />
        <Description>
          {copy.description}{' '}
          <AnswersInfo label={copy.howWeGotIt}>
            {copy.explanation(answers)}
          </AnswersInfo>
        </Description>
      </>
    )
  }

  const copy = SERVE_STORY_COPY.grow
  return (
    <>
      <h1 className={TITLE_CLASS} style={{ fontFamily: 'var(--font-geist)' }}>
        {copy.title}
      </h1>
      <Description>{copy.description}</Description>
      <ol className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {copy.loop.map((item, index) => (
          <li
            key={item.title}
            className="flex items-center gap-3 rounded-xl border border-base-border bg-card p-3.5 sm:flex-col sm:items-start sm:gap-1.5"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {index + 1}
            </span>
            <span className="flex flex-col sm:gap-1">
              <span className="font-semibold text-foreground">
                {item.title}
              </span>
              <span className="text-sm text-muted-foreground">{item.desc}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshIcon className="h-4 w-4 shrink-0 text-primary" />
        {copy.again}
      </p>
    </>
  )
}
