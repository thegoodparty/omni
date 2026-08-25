import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { CreateFlowStep } from './createFlow/CreateListFlow'
import type { PolygonRing } from './VoterMapCanvas'
import CreateListSurface, {
  useCreateListDraw,
  type CreateListSurfaceProps,
} from './CreateListSurface'

// The wizard's steps have their own suite. Stubbed to the preview contract this
// seam now owns, plus the controls that drive it.
const flowProps: {
  current: {
    addressPreview: { doors: number } | null
    previewPending: boolean
    previewFailed: boolean
    previewStale: boolean
    savedLists: { id: number; name: string; households: number | null }[]
    allContactsHouseholds: number | null
  } | null
} = { current: null }
vi.mock('./createFlow/CreateListFlow', () => ({
  __esModule: true,
  default: (props: {
    addressPreview: { doors: number } | null
    previewPending: boolean
    previewFailed: boolean
    previewStale: boolean
    savedLists: { id: number; name: string; households: number | null }[]
    allContactsHouseholds: number | null
    onShowAddresses: () => void
    onHideAddresses: () => void
    onStepChange: (step: CreateFlowStep) => void
    onSaved: (drawAnother: boolean) => void
  }) => {
    flowProps.current = props
    return (
      <div data-testid="create-flow">
        <button type="button" onClick={props.onShowAddresses}>
          show addresses
        </button>
        <button type="button" onClick={props.onHideAddresses}>
          hide addresses
        </button>
        <button type="button" onClick={() => props.onStepChange('filters')}>
          back to filters
        </button>
        <button type="button" onClick={() => props.onSaved(true)}>
          save and draw another
        </button>
      </div>
    )
  },
}))

const previewCalls = { count: 0 }
const mockPreview = () => {
  previewCalls.count = 0
  api.mock('POST /v1/door-knocking/address-preview', () => {
    previewCalls.count += 1
    return {
      status: 200,
      data: { stops: 1, doors: 2, people: 2, locations: [] },
    }
  })
}

// Three households on two dots, two of them Democratic — the same shape the
// page's own pack fixture has, so the counts below are readable.
const pack = {
  manifest: {
    version: 1,
    generatedAt: '2026-08-20T12:00:00Z',
    counts: { people: 4, households: 3, dots: 2 },
    dims: [{ key: 'party', values: ['Unknown', 'Democratic', 'Republican'] }],
    arrays: [],
  },
  positions: new Float32Array([-87.65, 41.9, -87.66, 41.91]),
  personToHousehold: new Uint32Array([0, 0, 1, 2]),
  householdToDot: new Uint32Array([0, 0, 1]),
  dimPlanes: new Map([['party', new Uint8Array([1, 1, 1, 2])]]),
}

const ringA: PolygonRing = [
  [-87.67, 41.885],
  [-87.63, 41.885],
  [-87.65, 41.95],
]

const onStepChange = vi.fn()
const onSaved = vi.fn()

const surface = (overrides: Partial<CreateListSurfaceProps> = {}) => (
  <CreateListSurface
    step="draw"
    filters={{}}
    onFiltersChange={vi.fn()}
    onStepChange={onStepChange}
    onClose={vi.fn()}
    districtHouseholds={0}
    ring={ringA}
    turfStats={null}
    drawPointCount={3}
    onUndoPoint={vi.fn()}
    onClearPoints={vi.fn()}
    onSaved={onSaved}
    isElectedOfficial={false}
    unpreviewableKeys={[]}
    {...overrides}
  />
)

describe('CreateListSurface seam', () => {
  beforeEach(() => {
    testQueryClient.clear()
    flowProps.current = null
    onStepChange.mockClear()
    onSaved.mockClear()
    mockPreview()
  })

  // The cost rule the whole surface is built around: drawing asks nothing of
  // the server, and a shut panel has no answer to show.
  it('asks nothing until the addresses are asked for', async () => {
    render(surface())

    await waitFor(() => expect(screen.getByTestId('create-flow')).toBeTruthy())
    expect(previewCalls.count).toBe(0)
    expect(flowProps.current?.addressPreview).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'show addresses' }))

    await waitFor(() =>
      expect(flowProps.current?.addressPreview?.doors).toBe(2),
    )
    expect(previewCalls.count).toBe(1)
  })

  // An answer belongs to the ring it was asked about. Moving a vertex makes it
  // stale rather than triggering a second scan of people-db.
  it('goes stale when the boundary moves, and does not refetch', async () => {
    const view = render(surface())

    fireEvent.click(screen.getByRole('button', { name: 'show addresses' }))
    await waitFor(() =>
      expect(flowProps.current?.addressPreview?.doors).toBe(2),
    )

    // A fresh array with the same coordinates, the way the canvas emits one per
    // change — reference identity is what makes an answer belong to a shape.
    view.rerender(surface({ ring: [...ringA] }))

    await waitFor(() => expect(flowProps.current?.previewStale).toBe(true))
    expect(flowProps.current?.addressPreview).toBeNull()
    expect(previewCalls.count).toBe(1)
  })

  // Both are a re-cut audience with a wiped shape, so the panel must not spring
  // back over a list nobody has asked about yet. The surface owns the reset; the
  // orchestrator only hears about the step.
  it('drops the panel on the way back to the filters', async () => {
    render(surface())

    fireEvent.click(screen.getByRole('button', { name: 'show addresses' }))
    await waitFor(() =>
      expect(flowProps.current?.addressPreview?.doors).toBe(2),
    )

    fireEvent.click(screen.getByRole('button', { name: 'back to filters' }))

    await waitFor(() => expect(flowProps.current?.addressPreview).toBeNull())
    expect(flowProps.current?.previewStale).toBe(false)
    expect(onStepChange).toHaveBeenCalledWith('filters')
  })

  it('drops the panel after a save that draws another', async () => {
    render(surface())

    fireEvent.click(screen.getByRole('button', { name: 'show addresses' }))
    await waitFor(() =>
      expect(flowProps.current?.addressPreview?.doors).toBe(2),
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'save and draw another' }),
    )

    await waitFor(() => expect(flowProps.current?.addressPreview).toBeNull())
    expect(onSaved).toHaveBeenCalledWith(true)
  })

  // The who step's picker, counted against the same pack the map is drawn
  // from. Both reads are the page's own query keys, which is the point: the
  // saved lists are already warm and the pack is emphatically not this
  // surface's to fetch.
  it('counts the saved lists off the pack the page already holds', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 4, name: 'Democrats', partyDemocrat: true }],
    })
    testQueryClient.setQueryData(['door-knocking-pack'], pack)

    render(surface())

    await waitFor(() =>
      expect(flowProps.current?.savedLists).toEqual([
        {
          id: 4,
          name: 'Democrats',
          households: 2,
          filters: { partyDemocrat: true },
        },
      ]),
    )
    expect(flowProps.current?.allContactsHouseholds).toBe(3)
  })

  // A pack fetch here would be a second tens-of-MB download of what the page
  // already gates the whole feature on, so the observer is read-only.
  it('fetches no pack of its own, and offers the lists uncounted until one lands', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 4, name: 'Democrats', partyDemocrat: true }],
    })

    render(surface())

    await waitFor(() => expect(flowProps.current?.savedLists).toHaveLength(1))
    expect(flowProps.current?.savedLists[0]?.households).toBeNull()
    expect(flowProps.current?.allContactsHouseholds).toBeNull()
    expect(
      fetchSpy.mock.calls.filter(([input]) => String(input).includes('/pack')),
    ).toHaveLength(0)
    fetchSpy.mockRestore()
  })
})

// The surface's other half: what the draw step asks of the canvas. It lives in
// the orchestrator because the canvas outlives the flow, so the contract is the
// hook's return shape rather than a prop list.
describe('useCreateListDraw', () => {
  const Probe = ({ step }: { step: CreateFlowStep | null }) => {
    const draw = useCreateListDraw(step)
    return (
      <div
        data-testid="draw"
        data-start={String(draw.startDrawToken)}
        data-clear={String(draw.clearDrawToken)}
        data-undo={String(draw.undoDrawToken)}
        data-points={String(draw.pointCount)}
        data-hint={String(draw.hintVisible)}
      >
        <button type="button" onClick={draw.startDrawing}>
          start
        </button>
        <button type="button" onClick={draw.clearPoints}>
          clear points
        </button>
        <button type="button" onClick={draw.clearDrawing}>
          clear drawing
        </button>
        <button type="button" onClick={draw.undoPoint}>
          undo
        </button>
        <button type="button" onClick={draw.dismissHint}>
          dismiss
        </button>
        <button type="button" onClick={() => draw.onPointCount(1)}>
          place a point
        </button>
      </div>
    )
  }

  it('turns Clear into a restarted session, not an emptied one', () => {
    render(<Probe step="draw" />)

    fireEvent.click(screen.getByRole('button', { name: 'clear points' }))

    // A restarted drawing session (empty ring, still in draw mode) is exactly
    // the state Clear returns to; bumping the clear token too would run
    // deleteAll after draw_polygon is entered and kill the fresh session.
    expect(screen.getByTestId('draw')).toHaveAttribute('data-start', '1')
    expect(screen.getByTestId('draw')).toHaveAttribute('data-clear', '0')
  })

  it('leaves the coach mark dismissed after a Clear, and brings it back on a new draw', () => {
    render(<Probe step="draw" />)

    expect(screen.getByTestId('draw')).toHaveAttribute('data-hint', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))
    expect(screen.getByTestId('draw')).toHaveAttribute('data-hint', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'clear points' }))
    expect(screen.getByTestId('draw')).toHaveAttribute('data-hint', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'start' }))
    expect(screen.getByTestId('draw')).toHaveAttribute('data-hint', 'true')
  })

  it('hides the coach mark once a point exists, and off the draw step', () => {
    const { rerender } = render(<Probe step="draw" />)

    fireEvent.click(screen.getByRole('button', { name: 'place a point' }))
    expect(screen.getByTestId('draw')).toHaveAttribute('data-hint', 'false')
    expect(screen.getByTestId('draw')).toHaveAttribute('data-points', '1')

    rerender(<Probe step="confirm" />)
    expect(screen.getByTestId('draw')).toHaveAttribute('data-hint', 'false')
  })

  it('bumps undo and clear-drawing on their own tokens', () => {
    render(<Probe step="draw" />)

    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'clear drawing' }))

    expect(screen.getByTestId('draw')).toHaveAttribute('data-undo', '1')
    expect(screen.getByTestId('draw')).toHaveAttribute('data-clear', '1')
    expect(screen.getByTestId('draw')).toHaveAttribute('data-start', '0')
  })
})
