import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { cn } from '@styleguide/lib/utils'

// How long a step's entrances wait: the slide between steps takes a moment,
// so a step reached from another one starts its own motion after it.
const EntranceOffsetContext = createContext(0)

export const STEP_ENTRANCE_OFFSET_MS = 260

export const EntranceOffset = EntranceOffsetContext.Provider

export const useEntranceOffset = (): number => useContext(EntranceOffsetContext)

const vars = (values: Record<string, string | number>): CSSProperties =>
  values as CSSProperties

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
}: {
  children: ReactNode
  delay?: number
  index?: number
  stagger?: number
  duration?: number
  ripple?: boolean
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
    return (
      <span
        key={key}
        className="ww-word"
        style={vars({
          '--i': at,
          '--d': `${delay + offset}ms`,
          ...(stagger ? { '--ww-word-stagger': `${stagger}ms` } : {}),
          ...(duration ? { '--ww-word-dur': `${duration}ms` } : {}),
        })}
      >
        <span
          key={rippleRun}
          className={cn(rippleRun > 0 && 'ww-ripple')}
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
}): React.JSX.Element => {
  const offset = useContext(EntranceOffsetContext)
  return (
    <div
      className={cn('ww-rise', className)}
      style={vars({ '--d': `${delay + offset}ms` })}
    >
      {children}
    </div>
  )
}

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
