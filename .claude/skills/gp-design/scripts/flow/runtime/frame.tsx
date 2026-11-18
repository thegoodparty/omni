// The frame a flow renders in stands in for the browser window. build.mjs turns
// Tailwind's width media queries into container queries on it and viewport units
// into container units; overlays portal into it (portal.tsx) and useIsMobile reads
// its width (use-mobile.ts). So a 375px frame on a wide page behaves like a phone.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type FrameState = { el: HTMLElement | null; width: number }

const FrameContext = createContext<FrameState>({ el: null, width: 0 })

export const useFrame = () => useContext(FrameContext)

export const Frame = ({
  className,
  id,
  children,
}: {
  className: string
  id?: string
  children: ReactNode
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<FrameState>({ el: null, width: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setState({ el, width: el.clientWidth })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={ref} id={id} className={className} data-gp-frame="">
      <FrameContext.Provider value={state}>
        <div data-gp-frame-scroll="">{state.el ? children : null}</div>
      </FrameContext.Provider>
    </div>
  )
}

// For the build-time snapshot: a phone-wide frame with no element to portal into.
export const StaticFrame = ({
  width,
  children,
}: {
  width: number
  children: ReactNode
}) => (
  <FrameContext.Provider value={{ el: null, width }}>
    {children}
  </FrameContext.Provider>
)
