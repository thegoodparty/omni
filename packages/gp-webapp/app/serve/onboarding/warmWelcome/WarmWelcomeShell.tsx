import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Button, GoodPartyOrgLogo } from '@styleguide'
import { ChevronLeftIcon } from '@styleguide/components/ui/icons'
import { cn } from '@styleguide/lib/utils'
import { ConfettiLayer } from './ConfettiLayer'
import {
  EntranceOffset,
  prefersReducedMotion,
  STEP_ENTRANCE_OFFSET_MS,
} from './Reveal'
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
  kind: 'primary' | 'secondary' | 'quiet'
  onClick: () => void
  disabled?: boolean
  loading?: boolean
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
        `${action.key}:${action.label}:${action.kind}:${action.disabled ? 1 : 0}:${action.loading ? 1 : 0}`,
    )
    .join('|')

// A screen's buttons live in the footer, bottom right, beside Back. The
// screen on show names them here; `id` is the screen (or the state inside
// it), so a new id hands the footer over and the same id updates in place.
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
      })),
    })
  }, [setDock, id, delay, shape])
}

const STEP_LEAVE_MS = 420
const DOCK_LEAVE_MS = 240

const BUTTON_VARIANT = {
  primary: 'default',
  secondary: 'outline',
  quiet: 'ghost',
} as const

const DockButtons = ({ dock }: { dock: Dock }): React.JSX.Element => (
  <div
    className="ww-rise flex items-center gap-2 sm:gap-3"
    style={{ '--d': `${dock.delay}ms` } as CSSProperties}
  >
    {dock.actions.map((action) => (
      <Button
        key={action.key}
        type="button"
        size="large"
        variant={BUTTON_VARIANT[action.kind]}
        data-kind={action.kind}
        onClick={action.onClick}
        disabled={action.disabled}
        loading={action.loading}
      >
        {action.label}
      </Button>
    ))}
  </div>
)

// The warm welcome's frame: the logo and a breadcrumb of the steps along the
// top, the step on a full-height stage, and a footer with Back on the left
// and the step's own buttons on the right. There is no step counter.
export const WarmWelcomeShell = ({
  steps,
  step,
  onGoTo,
  notice,
  children,
}: {
  steps: WarmWelcomeStepId[]
  step: WarmWelcomeStepId
  onGoTo: (step: WarmWelcomeStepId) => void
  // A message above the stage, outside the flow itself.
  notice?: ReactNode
  children: (step: WarmWelcomeStepId) => ReactNode
}): React.JSX.Element => {
  const [shown, setShown] = useState(step)
  const [leaving, setLeaving] = useState<WarmWelcomeStepId | null>(null)
  const [moved, setMoved] = useState(false)
  const [dock, setDockState] = useState<Dock | null>(null)
  const [leavingDock, setLeavingDock] = useState<Dock | null>(null)
  const dockRef = useRef<Dock | null>(null)
  const footerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (step === shown) return
    const reduced = prefersReducedMotion()
    setMoved(true)
    setLeaving(reduced ? null : shown)
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

  return (
    <ConfettiLayer floorRef={footerRef}>
      <div className="ww fixed inset-0 flex flex-col bg-base-surface text-foreground">
        <header className="ww-topbar mx-auto flex w-full max-w-[960px] flex-none items-center gap-5 px-4">
          <GoodPartyOrgLogo size="small" className="flex-none" />
          <nav
            aria-label={WARM_WELCOME_COPY.steps}
            className="flex min-w-0 flex-1 gap-2"
          >
            {steps.map((id, at) => (
              // The breadcrumb segment is a bar over a label, which no
              // styleguide control draws.
              <button
                key={id}
                type="button"
                className="ww-crumb"
                data-reached={at <= index}
                aria-current={at === index ? 'step' : undefined}
                disabled={at > index}
                onClick={() => onGoTo(id)}
              >
                <i />
                <span>{WARM_WELCOME_STEP_LABELS[id]}</span>
              </button>
            ))}
          </nav>
        </header>

        {notice}

        <main className="ww-stage relative min-h-0 flex-1">
          {(leaving ? [leaving, shown] : [shown]).map((id) => (
            <section
              key={id}
              aria-label={WARM_WELCOME_STEP_LABELS[id]}
              aria-hidden={id === leaving ? true : undefined}
              inert={id === leaving}
              className={cn(
                'ww-step',
                id === leaving ? 'ww-step-leave' : moved && 'ww-step-enter',
              )}
            >
              <DockContext.Provider value={id === leaving ? NO_DOCK : setDock}>
                <EntranceOffset
                  value={moved && id !== leaving ? STEP_ENTRANCE_OFFSET_MS : 0}
                >
                  {children(id)}
                </EntranceOffset>
              </DockContext.Provider>
            </section>
          ))}
        </main>

        <footer
          ref={footerRef}
          className="flex-none bg-base-surface pb-[env(safe-area-inset-bottom)]"
        >
          <div className="ww-foot mx-auto flex w-full max-w-[960px] items-center justify-between gap-2 px-4">
            <Button
              type="button"
              variant="ghost"
              size="large"
              aria-label={WARM_WELCOME_COPY.back}
              disabled={!previous}
              onClick={() => previous && onGoTo(previous)}
            >
              <ChevronLeftIcon className="sm:hidden" aria-hidden />
              <span className="hidden sm:inline">{WARM_WELCOME_COPY.back}</span>
            </Button>
            <div className="relative flex min-w-0 items-center justify-end">
              {leavingDock && (
                <div key={leavingDock.id} className="ww-dock-leave" inert>
                  <DockButtons dock={leavingDock} />
                </div>
              )}
              {dock && (
                <div key={dock.id}>
                  <DockButtons dock={dock} />
                </div>
              )}
            </div>
          </div>
        </footer>
      </div>
    </ConfettiLayer>
  )
}
