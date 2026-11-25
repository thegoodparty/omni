import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { reportClientError } from '@shared/observability/reportClientError'
import { createConfetti, type Confetti } from './confetti'
import { prefersReducedMotion } from './Reveal'

type ConfettiControls = Pick<
  Confetti,
  'pour' | 'burst' | 'addSurface' | 'clear'
>

const ConfettiContext = createContext<ConfettiControls>({
  pour: () => undefined,
  burst: () => undefined,
  addSurface: () => undefined,
  clear: () => undefined,
})

export const useConfetti = (): ConfettiControls => useContext(ConfettiContext)

// One canvas over the whole frame. The physics library loads the first time
// a step asks for confetti, and never under reduced motion, where the
// celebration is left out and everything it surrounds stays.
export const ConfettiLayer = ({
  floorRef,
  children,
}: {
  // Pieces land on this element's top edge.
  floorRef: RefObject<HTMLElement | null>
  children: ReactNode
}): React.JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const confettiRef = useRef<Confetti | null>(null)
  const loadingRef = useRef<Promise<Confetti | null> | null>(null)
  // Bumped by clear, so a pour or pop asked for before the library arrived
  // does not start after the step that asked has gone.
  const epochRef = useRef(0)

  const controls = useMemo((): ConfettiControls => {
    const load = (): Promise<Confetti | null> => {
      if (prefersReducedMotion()) return Promise.resolve(null)
      loadingRef.current ??= import('matter-js')
        .then((matter) => {
          const canvas = canvasRef.current
          if (!canvas) return null
          confettiRef.current = createConfetti(
            matter.default,
            canvas,
            () => floorRef.current,
          )
          return confettiRef.current
        })
        .catch((err: Error) => {
          reportClientError(err, { context: 'serveWarmWelcome.confetti' })
          return null
        })
      return loadingRef.current
    }
    const run = (action: (confetti: Confetti) => void): void => {
      const epoch = epochRef.current
      void load().then((confetti) => {
        if (confetti && epoch === epochRef.current) action(confetti)
      })
    }
    return {
      pour: () => run((confetti) => confetti.pour()),
      burst: (from, count) => run((confetti) => confetti.burst(from, count)),
      addSurface: (surface) => run((confetti) => confetti.addSurface(surface)),
      clear: () => {
        epochRef.current += 1
        confettiRef.current?.clear()
      },
    }
  }, [floorRef])

  useEffect(() => () => confettiRef.current?.destroy(), [])

  return (
    <ConfettiContext.Provider value={controls}>
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden
        className="ww-confetti pointer-events-none fixed inset-0 z-20 size-full"
      />
    </ConfettiContext.Provider>
  )
}
