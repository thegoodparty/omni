import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@styleguide/lib/utils'
import { DistrictBasemap } from './DistrictBasemap'
import {
  VIEW_HEIGHT,
  VIEW_WIDTH,
  type DistrictDot,
  type DistrictDots,
  type DistrictMapMode,
} from './districtDots'

const MODE_ORDER: DistrictMapMode[] = ['all', 'dim', 'sample', 'grow']

// Motion spec, in ms. Kept together so a designer review changes one place.
export const DISTRICT_MOTION = {
  introSweep: 650,
  introJitter: 150,
  introDuration: 500,
  dim: 400,
  sample: 600,
  sampleStagger: 5,
  rings: 400,
  fillStagger: 40,
  fillDuration: 250,
  back: 300,
} as const

interface Look {
  scale: number
  opacity: number
  fill: string
  ring: boolean
}

const lookFor = (
  dot: DistrictDot,
  mode: DistrictMapMode,
  filled: boolean,
): Look => {
  switch (mode) {
    case 'dim':
      return dot.loud
        ? { scale: 0.95, opacity: 1, fill: 'fill-warning', ring: false }
        : {
            scale: 0.6,
            opacity: 0.8,
            fill: 'fill-muted-foreground',
            ring: false,
          }
    case 'sample':
      return dot.sample
        ? { scale: 1, opacity: 1, fill: 'fill-primary', ring: false }
        : {
            scale: 0.5,
            opacity: 0.7,
            fill: 'fill-muted-foreground',
            ring: false,
          }
    case 'grow':
      if (dot.joinedOrder >= 0 && filled) {
        return { scale: 1, opacity: 1, fill: 'fill-primary', ring: false }
      }
      return dot.sample
        ? { scale: 1, opacity: 1, fill: 'fill-card', ring: true }
        : {
            scale: 0.5,
            opacity: 0.55,
            fill: 'fill-muted-foreground',
            ring: false,
          }
    default:
      return { scale: 0.65, opacity: 0.85, fill: 'fill-primary', ring: false }
  }
}

const timingFor = (
  dot: DistrictDot,
  index: number,
  {
    intro,
    from,
    to,
    filled,
  }: {
    intro: boolean
    from: DistrictMapMode | null
    to: DistrictMapMode
    filled: boolean
  },
): { duration: number; delay: number } => {
  if (intro) {
    const jitter = ((index * 37) % 100) / 100
    return {
      duration: DISTRICT_MOTION.introDuration,
      delay: Math.round(
        dot.wave * DISTRICT_MOTION.introSweep +
          jitter * DISTRICT_MOTION.introJitter,
      ),
    }
  }
  if (from === null || from === to) {
    if (to === 'grow' && filled && dot.joinedOrder >= 0) {
      return {
        duration: DISTRICT_MOTION.fillDuration,
        delay: dot.joinedOrder * DISTRICT_MOTION.fillStagger,
      }
    }
    return { duration: 0, delay: 0 }
  }
  if (MODE_ORDER.indexOf(to) < MODE_ORDER.indexOf(from)) {
    return { duration: DISTRICT_MOTION.back, delay: 0 }
  }
  if (to === 'dim') return { duration: DISTRICT_MOTION.dim, delay: 0 }
  if (to === 'sample') {
    return {
      duration: DISTRICT_MOTION.sample,
      delay: dot.sample ? dot.sampleOrder * DISTRICT_MOTION.sampleStagger : 0,
    }
  }
  return { duration: DISTRICT_MOTION.rings, delay: 0 }
}

export interface DistrictStoryMapProps {
  model: DistrictDots
  mode: DistrictMapMode
  // False for reduced motion: every mode shows its end state.
  animate: boolean
  // Whether to play the intro. False once it has played this session.
  intro: boolean
  onIntroDone?: () => void
}

// One map for the whole story: the dots never move, only their look changes,
// so stepping through reads as one continuous picture.
export const DistrictStoryMap = ({
  model,
  mode,
  animate,
  intro: introAllowed,
  onIntroDone,
}: DistrictStoryMapProps): React.JSX.Element => {
  const [playIntro] = useState(animate && introAllowed && mode === 'all')
  const onIntroDoneRef = useRef(onIntroDone)
  useEffect(() => {
    onIntroDoneRef.current = onIntroDone
  })
  const [introShown, setIntroShown] = useState(!playIntro)
  // Which mode change is playing. Updated during render, not in an effect, so
  // the first frame of a new mode already carries its timing; an effect would
  // commit the new look with no transition and the change would snap.
  // `filled` is false while the grow step shows the sample as rings, before
  // some of them fill in.
  const [change, setChange] = useState<{
    from: DistrictMapMode | null
    to: DistrictMapMode
    filled: boolean
  }>({ from: null, to: mode, filled: true })
  if (change.to !== mode) {
    const from = animate ? change.to : null
    setChange({
      from,
      to: mode,
      filled: !(mode === 'grow' && from === 'sample'),
    })
  }

  useEffect(() => {
    if (!playIntro) return
    const frame = requestAnimationFrame(() => {
      setIntroShown(true)
      onIntroDoneRef.current?.()
    })
    return () => cancelAnimationFrame(frame)
  }, [playIntro])

  useEffect(() => {
    if (change.filled) return
    const timer = setTimeout(
      () => setChange((now) => ({ ...now, from: null, filled: true })),
      DISTRICT_MOTION.rings,
    )
    return () => clearTimeout(timer)
  }, [change.filled])

  const filled = change.filled
  const transition = change
  const intro =
    playIntro && introShown && change.from === null && mode === 'all'
  const hidden = playIntro && !introShown

  const svg = (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      className={
        model.camera
          ? 'pointer-events-none absolute inset-0 h-full w-full'
          : 'block h-auto w-full'
      }
      role="img"
      aria-label={
        model.abstract
          ? 'An illustration of a district as dots'
          : 'Your district as dots'
      }
      data-testid="district-story-map"
      data-mode={mode}
      data-abstract={model.abstract ? 'true' : 'false'}
    >
      {model.outline && (
        <path
          d={model.outline}
          className="fill-muted stroke-base-border"
          strokeWidth={0.4}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {model.dots.map((dot, index) => {
        const look = lookFor(dot, mode, filled)
        const timing = timingFor(dot, index, {
          intro,
          from: transition.from,
          to: mode,
          filled,
        })
        const style: CSSProperties = {
          transform: `scale(${hidden ? 0 : look.scale})`,
          opacity: hidden ? 0 : look.opacity,
          transitionDuration: `${timing.duration}ms`,
          transitionDelay: `${timing.delay}ms`,
        }
        return (
          <circle
            key={index}
            cx={dot.x}
            cy={dot.y}
            r={1}
            strokeWidth={look.ring ? 0.45 : 0.3}
            data-look={look.ring ? 'ring' : look.fill}
            className={cn(
              'origin-center transition-[transform,opacity,fill,stroke-width] ease-out [transform-box:fill-box] motion-reduce:transition-none',
              look.ring ? 'stroke-primary' : 'stroke-card',
              look.fill,
            )}
            style={style}
          />
        )
      })}
      {mode === 'dim' &&
        model.dots
          .filter((dot) => dot.loud)
          .map((dot, index) => (
            <circle
              key={`halo-${index}`}
              cx={dot.x}
              cy={dot.y}
              r={2.4}
              data-testid="district-story-halo"
              className="origin-center animate-pop-in fill-warning opacity-25 [transform-box:fill-box] motion-reduce:animate-none"
            />
          ))}
      {mode === 'dim' && model.abstract && (
        <g aria-hidden="true">
          <rect
            x={model.center.x - 7}
            y={model.center.y - 12}
            width={14}
            height={5}
            rx={1.2}
            className="fill-foreground"
          />
          <text
            x={model.center.x}
            y={model.center.y - 8.6}
            textAnchor="middle"
            className="fill-background text-[2.6px] font-semibold"
          >
            City Hall
          </text>
          <line
            x1={model.center.x}
            x2={model.center.x}
            y1={model.center.y - 7}
            y2={model.center.y - 4}
            strokeWidth={0.5}
            className="stroke-foreground"
          />
        </g>
      )}
    </svg>
  )

  if (!model.camera) return svg
  // The frame has the view's shape, so the basemap and the dots share one
  // box and the dots sit on their streets.
  return (
    <div
      className="relative aspect-[100/93] w-full overflow-hidden bg-muted"
      data-testid="district-story-frame"
    >
      <DistrictBasemap camera={model.camera} />
      {svg}
    </div>
  )
}
