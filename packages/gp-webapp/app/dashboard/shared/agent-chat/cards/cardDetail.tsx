import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Sheet, SheetContent, SheetTitle } from '@styleguide'

type ActiveDetail = { key: string; title: string }

type CardDetailContextValue = {
  active: ActiveDetail | null
  open: (detail: ActiveDetail) => void
  close: () => void
  container: HTMLElement | null
  setContainer: (node: HTMLElement | null) => void
}

const CardDetailContext = createContext<CardDetailContextValue | null>(null)

/**
 * One open card detail per conversation. The surface decides where the panel
 * mounts (a host calls `setContainer`); the card decides what goes in it, and
 * portals it there so the detail stays in the card's own tree. That is what
 * keeps a proposal's unsent edits alive across close and reopen: the state
 * lives in the card, not in the panel.
 */
export const CardDetailProvider = ({ children }: { children: ReactNode }) => {
  const [active, setActive] = useState<ActiveDetail | null>(null)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const open = useCallback((detail: ActiveDetail) => setActive(detail), [])
  const close = useCallback(() => setActive(null), [])
  const value = useMemo(
    () => ({ active, open, close, container, setContainer }),
    [active, open, close, container],
  )
  return (
    <CardDetailContext.Provider value={value}>
      {children}
    </CardDetailContext.Provider>
  )
}

export const useCardDetailHost = (): CardDetailContextValue => {
  const ctx = useContext(CardDetailContext)
  if (!ctx) throw new Error('useCardDetailHost needs a CardDetailProvider')
  return ctx
}

// The contacts page's person panel shell (`PersonOverlay`), so a card's
// detail opens the way a constituent's does.
const SHEET_CLASS =
  'h-full w-screen gap-0 overflow-hidden p-0 pb-0 sm:w-[90vw] sm:max-w-xl'

const DetailSheet = ({
  open,
  onOpenChange,
  title,
  bodyRef,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  bodyRef?: (node: HTMLElement | null) => void
  children?: ReactNode
}) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    {/* data-vaul-no-drag: Chief of Staff lives in a vaul drawer, and React
        bubbles a portal's pointer events up to it, so a drag-select in the
        script would otherwise start dragging the drawer shut. */}
    <SheetContent
      className={SHEET_CLASS}
      aria-describedby={undefined}
      data-vaul-no-drag
    >
      {/* A span, not a second heading: the detail opens on its own. */}
      <SheetTitle asChild>
        <span className="sr-only">{title}</span>
      </SheetTitle>
      <div ref={bodyRef} className="flex-1 overflow-y-auto p-6 pt-12">
        {children}
      </div>
    </SheetContent>
  </Sheet>
)

/** The right-side sheet host, for a surface with no rail of its own. */
export const CardDetailSheetHost = () => {
  const { active, close, setContainer } = useCardDetailHost()
  return (
    <DetailSheet
      open={active !== null}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title={active?.title ?? ''}
      bodyRef={setContainer}
    />
  )
}

/**
 * A compact chip in the stream and its full detail in the panel. Outside a
 * provider (a surface that never mounted one, or a test) the card falls back
 * to its own sheet, so a card can never render with no way to open it.
 */
export const CardDetail = ({
  detailKey,
  title,
  chip,
  children,
}: {
  detailKey?: string
  title: string
  chip: (props: { open: () => void; expanded: boolean }) => ReactNode
  children: ReactNode
}) => {
  const ctx = useContext(CardDetailContext)
  const fallbackKey = useId()
  const key = detailKey ?? fallbackKey
  const [localOpen, setLocalOpen] = useState(false)

  if (!ctx) {
    return (
      <>
        {chip({ open: () => setLocalOpen(true), expanded: localOpen })}
        <DetailSheet open={localOpen} onOpenChange={setLocalOpen} title={title}>
          {children}
        </DetailSheet>
      </>
    )
  }

  const expanded = ctx.active?.key === key
  return (
    <>
      {chip({ open: () => ctx.open({ key, title }), expanded })}
      {expanded && ctx.container ? createPortal(children, ctx.container) : null}
    </>
  )
}
