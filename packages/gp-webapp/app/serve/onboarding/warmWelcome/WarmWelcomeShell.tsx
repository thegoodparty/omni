import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ChevronLeftIcon } from '@styleguide/components/ui/icons'
import { ConfettiLayer, useConfetti } from './ConfettiLayer'
import {
  EntranceOffset,
  prefersReducedMotion,
  STEP_ENTRANCE_OFFSET_MS,
} from './Reveal'
import { Btn, cx, FoilLogo, Tap, vars, type BtnKind } from './parts'
import {
  WARM_WELCOME_COPY,
  WARM_WELCOME_STEP_LABELS,
  type WarmWelcomeStepId,
} from './warmWelcomeConfig'

export interface DockAction {
  key: string
  label: string
  // In a pair, the primary action is on the right and the secondary on the
  // left. A secondary action is never in the primary color.
  kind: Exclude<BtnKind, 'ghost'>
  onClick: () => void
  disabled?: boolean
  className?: string
  // What the button shows when it is more than its label.
  content?: ReactNode
  // The button's element, for a pop of confetti from it.
  onElement?: (element: HTMLButtonElement | null) => void
}

interface Dock {
  id: string
  delay: number
  actions: DockAction[]
}

const DockContext = createContext<(dock: Dock) => void>(() => undefined)

const NO_DOCK = (): void => undefined

const signature = (actions: DockAction[]): string =>
  actions
    .map(
      (action) =>
        `${action.key}:${action.label}:${action.kind}:${action.disabled ? 1 : 0}:${action.className ?? ''}`,
    )
    .join('|')

// A screen's buttons live in the footer, bottom right, beside Back. The
// screen on show names them here; `id` is the screen (or the state inside
// it), so a new id hands the footer over and the same id updates in place.
// `delay` is when they arrive, counted like every other entrance.
export const useDock = (
  id: string,
  delay: number,
  actions: DockAction[],
): void => {
  const setDock = useContext(DockContext)
  const latest = useRef(actions)
  latest.current = actions
  const shape = signature(actions)

  useEffect(() => {
    setDock({
      id,
      delay,
      actions: latest.current.map((action) => ({
        ...action,
        onClick: () =>
          latest.current.find(({ key }) => key === action.key)?.onClick(),
        onElement: (element) =>
          latest.current
            .find(({ key }) => key === action.key)
            ?.onElement?.(element),
      })),
    })
  }, [setDock, id, delay, shape])
}

// The frame's own element. On phones the date menus open as sheets pinned to
// the screen, and they have to live here: inside a step every animated
// ancestor would pin them to itself.
const ShellContext = createContext<HTMLElement | null>(null)

export const useShell = (): HTMLElement | null => useContext(ShellContext)

const STEP_LEAVE_MS = 420
const DOCK_LEAVE_MS = 320

const DockButtons = ({ dock }: { dock: Dock }): React.JSX.Element => (
  <>
    {dock.actions.map((action) => (
      <Btn
        key={action.key}
        kind={action.kind}
        className={action.className}
        onClick={action.onClick}
        disabled={action.disabled}
        ref={action.onElement}
      >
        {action.content ?? action.label}
      </Btn>
    ))}
  </>
)

// Confetti belongs to the step that threw it: it fades when the step is left.
const ClearConfettiOnStep = ({ step }: { step: string }): null => {
  const confetti = useConfetti()
  useEffect(() => {
    confetti.clear()
  }, [step, confetti])
  return null
}

// The warm welcome's frame: the logo and a breadcrumb of the steps along the
// top, the step on a full-height stage, and a footer with Back on the left
// and the step's own buttons on the right. There is no step counter. The
// frame slides open when the flow starts and closed when it ends.
export const WarmWelcomeShell = ({
  steps,
  step,
  onGoTo,
  notice,
  exiting = false,
  children,
}: {
  steps: WarmWelcomeStepId[]
  step: WarmWelcomeStepId
  onGoTo: (step: WarmWelcomeStepId) => void
  // A message above the stage, outside the flow itself.
  notice?: ReactNode
  // Done was pressed and saved: the frame closes and the stage goes dark.
  exiting?: boolean
  children: (step: WarmWelcomeStepId) => ReactNode
}): React.JSX.Element => {
  const [shown, setShown] = useState(step)
  const [leaving, setLeaving] = useState<WarmWelcomeStepId | null>(null)
  const [opened, setOpened] = useState(false)
  const [dock, setDockState] = useState<Dock | null>(null)
  const [leavingDock, setLeavingDock] = useState<Dock | null>(null)
  const dockRef = useRef<Dock | null>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const [shell, setShell] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setOpened(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])

  useEffect(() => {
    if (step === shown) return
    setLeaving(prefersReducedMotion() ? null : shown)
    setShown(step)
  }, [step, shown])

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setLeaving(null), STEP_LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [shown])

  // The on-screen keyboard only shrinks the visual viewport, so the footer
  // is lifted by hand while something is being typed.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport || !shell) return
    const lift = (): void => {
      const active = document.activeElement
      const typing =
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))
      const height = typing
        ? Math.max(
            0,
            Math.round(
              window.innerHeight - viewport.height - viewport.offsetTop,
            ),
          )
        : 0
      shell.style.setProperty('--kb', `${height}px`)
    }
    const later = (): void => void setTimeout(lift, 60)
    viewport.addEventListener('resize', lift)
    viewport.addEventListener('scroll', lift)
    document.addEventListener('focusin', later)
    document.addEventListener('focusout', later)
    return () => {
      viewport.removeEventListener('resize', lift)
      viewport.removeEventListener('scroll', lift)
      document.removeEventListener('focusin', later)
      document.removeEventListener('focusout', later)
    }
  }, [shell])

  const setDock = useCallback((next: Dock) => {
    const previous = dockRef.current
    dockRef.current = next
    setDockState(next)
    if (previous && previous.id !== next.id) setLeavingDock(previous)
  }, [])

  useEffect(() => {
    if (!leavingDock) return
    const timer = setTimeout(() => setLeavingDock(null), DOCK_LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leavingDock])

  const index = steps.indexOf(shown)
  const previous = index > 0 ? steps[index - 1] : undefined
  const closed = !opened || exiting
  const docks = [
    ...(leavingDock && leavingDock.id !== dock?.id ? [leavingDock] : []),
    ...(dock ? [dock] : []),
  ]

  return (
    <div className="ww">
      <ConfettiLayer floorRef={footerRef}>
        <ClearConfettiOnStep step={shown} />
        <ShellContext.Provider value={shell}>
          <div className="shell" ref={setShell}>
            <header className={cx('topbar', closed && 'off')}>
              <FoilLogo width={24} label={WARM_WELCOME_COPY.brand} />
              <nav className="bars" aria-label={WARM_WELCOME_COPY.steps}>
                {steps.map((id, at) => (
                  <Tap
                    key={id}
                    className={at <= index ? 'on' : undefined}
                    aria-current={at === index ? 'step' : undefined}
                    disabled={at > index}
                    onClick={() => onGoTo(id)}
                  >
                    <i />
                    <span>{WARM_WELCOME_STEP_LABELS[id]}</span>
                  </Tap>
                ))}
              </nav>
            </header>

            {notice && <div className="notice">{notice}</div>}

            <main className="stage">
              {(leaving ? [leaving, shown] : [shown]).map((id) => (
                <section
                  key={id}
                  aria-label={WARM_WELCOME_STEP_LABELS[id]}
                  aria-hidden={id === leaving ? true : undefined}
                  inert={id === leaving}
                  className={cx('step', id === leaving ? 'leave' : 'enter')}
                >
                  <DockContext.Provider
                    value={id === leaving ? NO_DOCK : setDock}
                  >
                    <EntranceOffset
                      value={id === leaving ? 0 : STEP_ENTRANCE_OFFSET_MS}
                    >
                      {children(id)}
                    </EntranceOffset>
                  </DockContext.Provider>
                </section>
              ))}
              <div className={cx('exit', exiting && 'in')} aria-hidden />
            </main>

            <footer className={cx('foot', closed && 'off')} ref={footerRef}>
              <div>
                <Btn
                  kind="ghost"
                  className="back"
                  aria-label={WARM_WELCOME_COPY.back}
                  disabled={!previous || exiting}
                  onClick={() => previous && onGoTo(previous)}
                >
                  <ChevronLeftIcon className="i bi" aria-hidden />
                  <span className="bt">{WARM_WELCOME_COPY.back}</span>
                </Btn>
                <div className="facts">
                  {docks.map((item) => {
                    const gone = item !== dock
                    return (
                      <div
                        key={item.id}
                        className={cx('acts ui', gone && 'gone')}
                        style={vars({ '--d': `${item.delay}ms` })}
                        inert={gone}
                      >
                        <DockButtons dock={item} />
                      </div>
                    )
                  })}
                </div>
              </div>
            </footer>
          </div>
        </ShellContext.Provider>
      </ConfettiLayer>
    </div>
  )
}
