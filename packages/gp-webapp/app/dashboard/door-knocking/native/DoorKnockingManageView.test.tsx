import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import DoorKnockingManageView, {
  type DoorKnockingManageViewProps,
  type MapScope,
} from './DoorKnockingManageView'

// The rail's rows are TurfList's business and are exercised by its own suite.
// Stubbed here so this file asserts only the seam — which props the manage
// surface hands down, and which gestures it hands back up.
vi.mock('./TurfList', () => ({
  __esModule: true,
  default: ({
    selectedTurfId,
    hiddenTurfIds,
    onFocusTurf,
    onToggleTurfVisibility,
    onShowDetails,
    onKnockTurf,
    onDeletedTurf,
    onCreateList,
  }: {
    selectedTurfId: number | null
    hiddenTurfIds: Set<number>
    onFocusTurf: (turf: DoorKnockingTurf) => void
    onToggleTurfVisibility: (turf: DoorKnockingTurf) => void
    onShowDetails: (turf: DoorKnockingTurf) => void
    onKnockTurf: (turf: DoorKnockingTurf) => void
    onDeletedTurf: (turf: DoorKnockingTurf) => void
    onCreateList?: () => void
  }) => (
    <div
      data-testid="turf-list"
      data-selected={String(selectedTurfId)}
      data-hidden={[...hiddenTurfIds].join(',')}
    >
      {(
        [
          ['focus', onFocusTurf],
          ['visibility', onToggleTurfVisibility],
          ['details', onShowDetails],
          ['knock', onKnockTurf],
          ['deleted', onDeletedTurf],
        ] as const
      ).map(([label, handler]) => (
        <button key={label} type="button" onClick={() => handler(turf)}>
          {label}
        </button>
      ))}
      {onCreateList && (
        <button type="button" onClick={onCreateList}>
          create
        </button>
      )}
    </div>
  ),
}))

const turf: DoorKnockingTurf = {
  id: 4,
  voterFileFilterId: 9,
  name: 'Maple & 3rd',
  color: '#2563eb',
  geoPoly: { type: 'Polygon', coordinates: [[]] },
  locked: false,
  doorCount: null,
  peopleCount: null,
  loggedCount: null,
  completedAt: null,
  archivedAt: null,
  createdAt: new Date('2026-07-21T00:00:00Z'),
  updatedAt: new Date('2026-07-21T00:00:00Z'),
}

const districtScope: MapScope = {
  turf: null,
  name: null,
  people: 1200,
  ready: true,
  pending: false,
  unavailable: false,
  unpreviewableLabels: [],
}

const handlers = () => ({
  onToggleStatus: vi.fn(),
  onSelectTurf: vi.fn(),
  onClearSelection: vi.fn(),
  onToggleTurfVisibility: vi.fn(),
  onShowDetails: vi.fn(),
  onKnockTurf: vi.fn(),
  onDeletedTurf: vi.fn(),
})

const renderView = (props: Partial<DoorKnockingManageViewProps> = {}) => {
  api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [turf] })
  const spies = handlers()
  const view = render(
    <DoorKnockingManageView
      scope={districtScope}
      statusCounts={{ unknown: 7, supporter: 2 }}
      statusFilter={new Set()}
      hiddenTurfIds={new Set()}
      {...spies}
      {...props}
    />,
  )
  return { ...view, ...spies }
}

describe('DoorKnockingManageView seam', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  // The four agents after Wave 1B read these as a contract, so the forwarding
  // is asserted rather than assumed: a surface that quietly stopped passing one
  // of these would look identical until the row it belongs to went dead.
  it('hands the rail rows the scope and the hidden set, and reports every gesture up', () => {
    const view = renderView({
      scope: { ...districtScope, turf, name: turf.name },
      hiddenTurfIds: new Set([11, 12]),
    })

    const list = screen.getByTestId('turf-list')
    expect(list).toHaveAttribute('data-selected', '4')
    expect(list).toHaveAttribute('data-hidden', '11,12')

    fireEvent.click(screen.getByRole('button', { name: 'focus' }))
    fireEvent.click(screen.getByRole('button', { name: 'visibility' }))
    fireEvent.click(screen.getByRole('button', { name: 'details' }))
    fireEvent.click(screen.getByRole('button', { name: 'knock' }))
    fireEvent.click(screen.getByRole('button', { name: 'deleted' }))

    expect(view.onSelectTurf).toHaveBeenCalledWith(turf)
    expect(view.onToggleTurfVisibility).toHaveBeenCalledWith(turf)
    expect(view.onShowDetails).toHaveBeenCalledWith(turf)
    expect(view.onKnockTurf).toHaveBeenCalledWith(turf)
    expect(view.onDeletedTurf).toHaveBeenCalledWith(turf)
  })

  // The empty rail's Create list button opens a flow that replaces this whole
  // surface, so the surface can only report the press. It passes the handler
  // through untouched, and offers the rail none when it has none — the rail
  // then names the header's button instead of rendering a dead one.
  it('passes the create-list gesture through, and only when it has one', () => {
    const onCreateList = vi.fn()
    const view = renderView({ onCreateList })

    fireEvent.click(screen.getByRole('button', { name: 'create' }))
    expect(onCreateList).toHaveBeenCalledTimes(1)

    view.unmount()
    renderView()
    expect(screen.queryByRole('button', { name: 'create' })).toBeNull()
  })

  // A chip reports the status and nothing else: whether it narrows, and what
  // that does to the dots, is the orchestrator's to decide.
  it('reports a chip press without deciding what it means', () => {
    const view = renderView()

    fireEvent.click(screen.getByRole('button', { name: /Support unknown\s*7/ }))

    expect(view.onToggleStatus).toHaveBeenCalledWith('unknown')
  })

  it('presses Show all rather than clearing the selection itself', () => {
    const view = renderView({
      scope: { ...districtScope, turf, name: turf.name, people: 30 },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))

    expect(view.onClearSelection).toHaveBeenCalled()
  })

  // The three scope states are one tri-state, and the chips are where the
  // difference is visible: a settled nothing prints an em dash, something still
  // arriving prints a skeleton, and neither may borrow the other's reading.
  it('distinguishes a scope still arriving from one that never will', () => {
    const { unmount } = renderView({
      scope: {
        ...districtScope,
        turf,
        name: turf.name,
        people: 0,
        ready: false,
        pending: true,
      },
    })
    const pendingChip = screen.getByRole('button', { name: /Supporter/ })
    expect(pendingChip.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(pendingChip).toBeDisabled()
    unmount()

    renderView({
      scope: {
        ...districtScope,
        turf,
        name: turf.name,
        people: 0,
        ready: false,
        unavailable: true,
      },
    })
    const settledChip = screen.getByRole('button', { name: /Supporter/ })
    expect(settledChip.textContent).toContain('—')
    expect(screen.getByText(/filters could not be loaded/)).toBeInTheDocument()
  })

  // The rail used to be `w-96 shrink-0` in the page's flex row above `lg`,
  // which took a fixed 384px column out of the map on the widest screens —
  // where the map is most of what the tool is. It floats over a full-bleed map
  // at every width now: a bottom sheet on a phone, an inset card on a desktop.
  it('floats over the map at every width rather than taking a column', () => {
    const { container } = renderView()

    const rail = container.querySelector('aside')
    expect(rail).toHaveClass('absolute')
    expect(rail).not.toHaveClass('lg:static')
    // Inset on all four sides above lg, which is what makes the map full-bleed
    // underneath it rather than merely beside it.
    expect(rail).toHaveClass('lg:inset-y-4', 'lg:right-4', 'lg:left-auto')
  })

  // The scope and its legend describe what the map is shading right now, so a
  // long rail must not be able to scroll the reading of the dots off screen.
  it('scrolls the lists and pins the legend under them', () => {
    const { container } = renderView()

    const legendSection = screen.getByRole('heading', {
      name: 'District voters',
    }).parentElement?.parentElement
    expect(legendSection).toHaveClass('shrink-0', 'border-t')
    expect(container.querySelector('.overflow-y-auto')).toContainElement(
      screen.getByTestId('turf-list'),
    )
  })

  // One row, scrolling. Wrapped, the seven chips stacked into three rows inside
  // a 384px rail and pushed the saved lists off the first screen of the
  // feature.
  it('keeps the legend on a single scrolling row', () => {
    const { container } = renderView()

    const group = container.querySelector(
      '[aria-label="Filter the map by canvass status"]',
    )
    expect(group).toHaveClass('flex-nowrap', 'w-max')
    expect(group?.parentElement).toHaveClass('overflow-x-auto')
  })

  // The one piece of state this surface owns outright. It is safe to own
  // because the orchestrator unmounts the whole surface for a create flow and
  // for a walk, which is exactly what "leaving the landing map resets it" means.
  it('owns the phone sheet, so leaving the landing map resets it', () => {
    const { unmount } = renderView()

    const handle = screen.getByRole('button', { name: /Lists and legend/ })
    expect(handle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(handle)
    expect(handle).toHaveAttribute('aria-expanded', 'true')
    unmount()

    renderView()
    expect(
      screen.getByRole('button', { name: /Lists and legend/ }),
    ).toHaveAttribute('aria-expanded', 'false')
  })
})
