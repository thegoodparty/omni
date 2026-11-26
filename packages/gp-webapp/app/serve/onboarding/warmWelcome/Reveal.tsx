import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { cx, vars } from './parts'

// How long a step's entrances wait: the slide between steps takes a moment,
// so a step reached from another one starts its own motion after it.
const EntranceOffsetContext = createContext(0)

export const STEP_ENTRANCE_OFFSET_MS = 260

export const EntranceOffset = EntranceOffsetContext.Provider

export const useEntranceOffset = (): number => useContext(EntranceOffsetContext)

export const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length

// A headline or lede that arrives a word at a time. A string child is split
// into words; an element child (an accent) arrives as one word. `index` is
// how many words came before it on the screen, so two lines read as one run.
export const Words = ({
  children,
  delay = 0,
  index = 0,
  stagger,
  duration,
  ripple = false,
  wordDelay,
}: {
  children: ReactNode
  delay?: number
  index?: number
  stagger?: number
  duration?: number
  ripple?: boolean
  // A later start for single words, by their place in this run.
  wordDelay?: (at: number) => number
}): React.JSX.Element => {
  const offset = useContext(EntranceOffsetContext)
  const [rippleRun, setRippleRun] = useState(0)

  useEffect(() => {
    if (!ripple) return
    const timer = setInterval(() => setRippleRun((run) => run + 1), 4200)
    return () => clearInterval(timer)
  }, [ripple])

  let position = index
  const word = (content: ReactNode, key: string): React.JSX.Element => {
    const at = position++
    const own = wordDelay ? wordDelay(at - index) : 0
    return (
      <span
        key={key}
        className="w"
        style={vars({
          '--i': at,
          '--d': `${delay + offset + own}ms`,
          ...(stagger ? { '--w-stagger': `${stagger}ms` } : {}),
          ...(duration ? { '--w-dur': `${duration}ms` } : {}),
        })}
      >
        <span
          key={rippleRun}
          className={cx('wi', rippleRun > 0 && 'rip')}
          style={vars({ '--i': at - index })}
        >
          {content}
        </span>
      </span>
    )
  }

  return (
    <>
      {Children.toArray(children).flatMap((child, childIndex) => {
        if (typeof child === 'string' || typeof child === 'number') {
          return String(child)
            .split(/(\s+)/)
            .filter((part) => part.length > 0)
            .map((part, partIndex) =>
              /^\s+$/.test(part)
                ? part
                : word(part, `${childIndex}-${partIndex}`),
            )
        }
        return isValidElement(child) ? [word(child, `${childIndex}`)] : []
      })}
    </>
  )
}

// The delay everything that is not a headline arrives with: `delay` after
// its step starts. Spread onto an element that carries the `ui` class.
export const useRise = (delay: number): React.CSSProperties => {
  const offset = useContext(EntranceOffsetContext)
  return vars({ '--d': `${delay + offset}ms` })
}

// Everything that is not a headline: it fades and rises in once, `delay`
// after its step starts.
export const Rise = ({
  delay,
  className,
  children,
}: {
  delay: number
  className?: string
  children: ReactNode
}): React.JSX.Element => (
  <div className={cx('ui', className)} style={useRise(delay)}>
    {children}
  </div>
)

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

const SUB_OUT_MS = 330

// One state of a step at a time. When `state` changes, the old content rises
// and fades away before the new content rises in and runs its own entrances.
export const useHandoff = <T extends string>(
  state: T,
): { shown: T; leaving: boolean; entered: boolean } => {
  const [shown, setShown] = useState(state)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (state === shown) return
    if (prefersReducedMotion()) {
      setShown(state)
      setEntered(true)
      return
    }
    const timer = setTimeout(() => {
      setShown(state)
      setEntered(true)
    }, SUB_OUT_MS)
    return () => clearTimeout(timer)
  }, [state, shown])

  return { shown, leaving: state !== shown, entered }
}

// The class a step's state carries while it hands off to the next one.
export const handoffClass = (handoff: {
  leaving: boolean
  entered: boolean
}): string | false =>
  handoff.leaving ? 'sub-out' : handoff.entered && 'sub-in'
