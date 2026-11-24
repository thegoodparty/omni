import { useLayoutEffect, useRef } from 'react'

// One rounded, non-interactive tint behind the recommended column, drawn from
// inside its header cell so it has no breaks at row borders. It reaches 20px
// above the header and 20px below the last row, which only a measurement of
// the table can say, so it follows the table's height. Design: Piece-f36k.
const OVERHANG_PX = 20

export const RecommendedPanel = (): React.JSX.Element => {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const panel = ref.current
    const cell = panel?.parentElement
    const table = panel?.closest('table')
    if (!panel || !cell || !table) return
    const fit = (): void => {
      const height =
        table.getBoundingClientRect().bottom -
        cell.getBoundingClientRect().top +
        OVERHANG_PX * 2
      panel.style.height = `${height}px`
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(table)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden
      data-testid="recommended-panel"
      className="pointer-events-none absolute inset-x-0 -top-5 -z-10 rounded-[20px]"
      style={{
        backgroundColor:
          'color-mix(in oklab, var(--color-primary) 5%, transparent)',
      }}
    />
  )
}
