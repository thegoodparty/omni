import * as React from 'react'
import { cn } from '@styleguide/lib/utils'

// Ported from the designer's Lottie export, one entry per layer. Every length
// is that file's value converted from its 224-unit canvas into the 64-unit
// burst box (x 0.2857); w/h come from the shape's 40.436 outer radius times its
// per-layer scale. The fan is deliberately lopsided and mostly upward — an even
// radial spread reads as a machine.
//
// mx/my are the source's mid keyframe, and they are why this table is not just
// start-and-end pairs: several paths are arcs, not lines. p5 swings to mx -0.1
// before ending at +5.4, and p9 rises to my -1.5 before settling at +4.8.
// Interpolating straight from origin to end flattens both into slides.
//
// spin/spinMid are the source's rotation sweep, but applied RELATIVE to a
// radial base rather than as absolute orientations. The source's own angles are
// hand-authored and not radially aligned (mean deviation ~41deg), which at this
// size reads as noise rather than intent — so the base orientation is computed
// from each particle's own travel direction and the sweep rides on top. The
// sweep is kept because it is non-monotonic and that is where the tumble lives:
// p3 swings +34deg and returns to -7, p4 +40 and back to +2.
const PARTICLES = [
  { dx: -23.8, dy: 0.9, mx: -15.1, my: 0.8, spin: -81, spinMid: -27, w: 3.3, h: 3.5, color: 'warning' }, // prettier-ignore
  { dx: -31.3, dy: -19.5, mx: -20.4, my: -18.3, spin: -181, spinMid: -124, w: 3.9, h: 5.1, color: 'secondary' }, // prettier-ignore
  { dx: -18.7, dy: -16.2, mx: -12.4, my: -15, spin: -7, spinMid: 34, w: 2.6, h: 3.5, color: 'warning' }, // prettier-ignore
  { dx: -11.3, dy: -25.7, mx: -5.2, my: -20.4, spin: 2, spinMid: 40, w: 2.6, h: 3.1, color: 'primary' }, // prettier-ignore
  { dx: 5.4, dy: -21, mx: -0.1, my: -14.4, spin: -131, spinMid: -75, w: 3.3, h: 5.3, color: 'secondary' }, // prettier-ignore
  { dx: 18.3, dy: -20.6, mx: 7, my: -16.8, spin: -46, spinMid: -27, w: 3.5, h: 3.9, color: 'primary' }, // prettier-ignore
  { dx: 20.8, dy: -16, mx: 5.5, my: -7.9, spin: -92, spinMid: -61, w: 2.5, h: 3.5, color: 'warning' }, // prettier-ignore
  { dx: 26.7, dy: -2.8, mx: 17, my: -7.2, spin: 62, spinMid: 40, w: 4.1, h: 5.2, color: 'secondary' }, // prettier-ignore
  { dx: 28.3, dy: 4.8, mx: 13, my: -1.5, spin: 194, spinMid: 43, w: 1.8, h: 3.7, color: 'primary' }, // prettier-ignore
  { dx: -26.3, dy: -4.6, mx: -17.7, my: -7.8, spin: 107, spinMid: 62, w: 4.7, h: 6.5, color: 'primary' }, // prettier-ignore
] as const

// Each particle starts oriented along its own outward direction, so the burst
// reads as debris thrown from the middle rather than ten shapes at unrelated
// angles. A diamond's long axis runs along whichever dimension is larger, so
// aligning that axis outward means taking 90deg off when it is taller than wide.
const radialBase = (p: (typeof PARTICLES)[number]) =>
  (Math.atan2(p.dy, p.dx) * 180) / Math.PI - (p.h >= p.w ? 90 : 0)

// Spin follows the throw: everything heading right rolls clockwise, everything
// heading left rolls counterclockwise, the way debris does when it is pushed
// out from a point. Five of the source's ten spin against their own direction,
// which reads as the burst having no physics, so only the MAGNITUDE of its
// sweep is kept and the sign comes from the trajectory.
const SPIN_FLOOR_DEG = 60 // p3 and p4 sweep 7deg and 2deg; without a floor they sit still
const SPIN_SCALE = 1.6 // overall energy — raise for a faster tumble
const spinFrom = (p: (typeof PARTICLES)[number], sweep: number) =>
  (p.dx >= 0 ? 1 : -1) * (Math.abs(sweep) + SPIN_FLOOR_DEG) * SPIN_SCALE

// The Lottie's crimson has no home in this token system, where red means
// destructive — confetti that reads as an error is the wrong signal. Warning
// (orange) keeps the mock's warmth without borrowing that meaning.
const PARTICLE_COLOR_VAR = {
  primary: 'var(--theme-primary)',
  secondary: 'var(--theme-secondary)',
  warning: 'var(--theme-warning)',
} as const

// One size for every burst, deliberately not a prop. A celebration that is
// bigger on one surface than another reads as inconsistent rather than
// responsive, and a variable size made the burst around a wide element (the Pro
// badge) noticeably heavier than the one around an icon.
const CENTER_PX = 24
// 3.2x is the handoff's 64px canvas over its 20px icon box. The burst is meant
// to overflow whatever it surrounds.
const BURST_PX = CENTER_PX * 3.2
// The particle table is authored in the Lottie's 64-unit burst box, so every
// length it holds is multiplied by this to reach rendered pixels. Keeping the
// table in source units is what lets it be checked against the Lottie.
const SCALE = BURST_PX / 64

// 131.5 of the Lottie's 224 canvas units: its 78.25 ellipse under a 168.06%
// group transform.
const RING_BASE_RATIO = 131.5 / 224

type ConfettiBurstProps = {
  /** Whatever sits at the center. Omit for a bare burst. */
  children?: React.ReactNode
  /** Flip false→true to fire. Re-flip to replay. */
  play?: boolean
  onComplete?: () => void
} & Omit<React.ComponentProps<'span'>, 'children'>

function ConfettiBurst({
  children,
  play = false,
  onComplete,
  className,
  style,
  ...props
}: ConfettiBurstProps) {
  // Remounts the burst subtree on every play, which is what restarts the CSS
  // animations. The class-remove-plus-reflow trick the shake token documents
  // would need a ref per particle; a key bump is one line and the particles
  // hold no state worth preserving.
  const [runId, setRunId] = React.useState(0)
  const hasFired = React.useRef(false)
  const centerRef = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (!play) return
    hasFired.current = true
    setRunId((id) => id + 1)

    // The center pops with the burst, so a caller never has to remember to add
    // the class themselves. Restarted by remove-reflow-add rather than a key
    // bump (the shake token documents the same trick): keying this element
    // would remount `children`, and an Avatar or an <img> in there would
    // re-request its source and flash on every replay.
    const el = centerRef.current
    if (!el) return
    el.classList.remove('animate-pop-in')
    void el.offsetWidth
    el.classList.add('animate-pop-in')
  }, [play])

  return (
    <span
      data-slot="confetti-burst"
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-visible',
        className,
      )}
      style={{ width: CENTER_PX, height: CENTER_PX, ...style }}
      {...props}
    >
      <span
        ref={centerRef}
        data-slot="confetti-burst-center"
        className="inline-flex items-center justify-center"
      >
        {children}
      </span>
      {hasFired.current && (
        <span
          key={runId}
          aria-hidden="true"
          data-slot="confetti-burst-canvas"
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={
            {
              width: BURST_PX,
              height: BURST_PX,
              '--confetti-scale': SCALE,
            } as React.CSSProperties
          }
          // Only the last particle reports, and only on its transform track:
          // each particle runs a transform and an opacity animation, so
          // matching on the element alone would fire twice per burst.
          onAnimationEnd={(event) => {
            if (event.currentTarget === event.target) return
            if (event.animationName !== 'confetti-fly') return
            const el = event.target as HTMLElement
            if (el.dataset.confettiLast === 'true') onComplete?.()
          }}
        >
          <span
            data-slot="confetti-burst-ring"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-solid"
            style={{
              // The ring's base diameter, 131.5 of the Lottie's 224 units. The
              // keyframes scale past this to 148%, so the rendered peak is
              // larger than the element.
              width: BURST_PX * RING_BASE_RATIO,
              height: BURST_PX * RING_BASE_RATIO,
              borderColor: 'var(--theme-primary)',
            }}
          />
          {PARTICLES.map((particle, index) => (
            <span
              key={index}
              data-slot="confetti-burst-particle"
              data-confetti-last={index === PARTICLES.length - 1}
              className="absolute left-1/2 top-1/2"
              style={
                {
                  width: particle.w * SCALE,
                  height: particle.h * SCALE,
                  marginLeft: (-particle.w * SCALE) / 2,
                  marginTop: (-particle.h * SCALE) / 2,
                  background: PARTICLE_COLOR_VAR[particle.color],
                  // The Lottie's shapes are 4-point polygons, not squares.
                  clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                  '--confetti-dx': `${particle.dx * SCALE}px`,
                  '--confetti-dy': `${particle.dy * SCALE}px`,
                  '--confetti-mx': `${particle.mx * SCALE}px`,
                  '--confetti-my': `${particle.my * SCALE}px`,
                  '--confetti-rot-start': `${radialBase(particle).toFixed(1)}deg`,
                  '--confetti-rot-mid': `${(radialBase(particle) + spinFrom(particle, particle.spinMid)).toFixed(1)}deg`,
                  '--confetti-rot-end': `${(radialBase(particle) + spinFrom(particle, particle.spin)).toFixed(1)}deg`,
                } as React.CSSProperties
              }
            />
          ))}
        </span>
      )}
    </span>
  )
}

export { ConfettiBurst }
export type { ConfettiBurstProps }
