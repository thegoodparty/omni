import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type {
  SegmentResponse,
  SupportStatusRollup,
} from 'app/dashboard/contacts/crm/shared/contacts-types'
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
    audienceEmpty: boolean
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
    audienceEmpty: boolean
    savedLists: { id: number; name: string; households: number | null }[]
    allContactsHouseholds: number | null
    onShowAddresses: () => void
    onHideAddresses: () => void
    onStepChange: (step: CreateFlowStep) => void
    onSelectedListChange: (
      listId: number | null,
      recommendedCriteria: {
        precincts: string[]
        supportStatus: SupportStatusRollup[]
      },
    ) => void
  }) => {
    flowProps.current = props
    return (
      <div data-testid="create-flow">
        <button
          type="button"
          onClick={() =>
            props.onSelectedListChange(4, {
              precincts: [],
              supportStatus: [],
            })
          }
        >
          pick list 4
        </button>
        <button
          type="button"
          onClick={() =>
            props.onSelectedListChange(null, {
              precincts: ['Cook|101', 'Cook|102'],
              supportStatus: ['undecided'],
            })
          }
        >
          accept recommendation
        </button>
        <button type="button" onClick={props.onShowAddresses}>
          show addresses
        </button>
        <button type="button" onClick={props.onHideAddresses}>
          hide addresses
        </button>
        <button type="button" onClick={() => props.onStepChange('filters')}>
          back to filters
        </button>
      </div>
    )
  },
}))

const previewCalls: { count: number; bodies: Record<string, unknown>[] } = {
  count: 0,
  bodies: [],
}
const mockPreview = () => {
  previewCalls.count = 0
  previewCalls.bodies = []
  api.mock('POST /v1/door-knocking/address-preview', ({ body }) => {
    previewCalls.count += 1
    previewCalls.bodies.push(body as Record<string, unknown>)
    return {
      status: 200,
      data: {
        stops: 1,
        doors: 2,
        people: 2,
        locations: [],
        // This fixture has an audience; these tests are about the request
        // this endpoint is sent, not about the two ways of finding nobody.
        audienceEmpty: false,
      },
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

const audienceCalls: { count: number; bodies: Record<string, unknown>[] } = {
  count: 0,
  bodies: [],
}
// `empty` is settable mid-test: the point of most of these is what happens
// when the answer CHANGES under a candidate who was told to go and change it.
const mockAudienceCheck = (empty = false) => {
  audienceCalls.count = 0
  audienceCalls.bodies = []
  api.mock('POST /v1/door-knocking/audience-check', ({ body }) => {
    audienceCalls.count += 1
    audienceCalls.bodies.push(body as Record<string, unknown>)
    return { status: 200, data: { empty } }
  })
}

// A list cut by support status: one of the three criteria that resolve to a
// person-id set, so it is one of the three that can come back empty.
const emptiableList = {
  id: 4,
  name: 'Persuasion walk list',
  supportStatus: ['undecided'] as SupportStatusRollup[],
}

const ringA: PolygonRing = [
  [-87.67, 41.885],
  [-87.63, 41.885],
  [-87.65, 41.95],
]

const onStepChange = vi.fn()
const onListCreated = vi.fn()

const surface = (overrides: Partial<CreateListSurfaceProps> = {}) => (
  <CreateListSurface
    step="draw"
    filters={{}}
    onFiltersChange={vi.fn()}
    precincts={[]}
    onPrecinctsChange={vi.fn()}
    precinctOptions={{
      options: [],
      truncated: false,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }}
    onStepChange={onStepChange}
    onClose={vi.fn()}
    districtBounds={null}
    districtHouseholds={0}
    districtHouseholdsPending={false}
    districtHouseholdsFailed={false}
    districtUnavailable={false}
    ring={ringA}
    drawFullScreen={false}
    onDrawFullScreenChange={vi.fn()}
    onRestartDrawing={vi.fn()}
    drawPointCount={3}
    drawnStops={null}
    onListCreated={onListCreated}
    isServeOrg={false}
    unpreviewableKeys={[]}
    orgSlug="campaign-9"
    turfDrafts={[]}
    draftStats={new Map()}
    onSelectDraft={vi.fn()}
    onUpdateDraft={vi.fn()}
    onRemoveDraft={vi.fn()}
    {...overrides}
  />
)

describe('CreateListSurface seam', () => {
  beforeEach(() => {
    testQueryClient.clear()
    flowProps.current = null
    onStepChange.mockClear()
    onListCreated.mockClear()
    mockPreview()
    mockAudienceCheck()
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

  // The pack cannot shade a support-status clause, but gp-api can evaluate it
  // exactly — the address preview runs the knock's own resolution. So the
  // draft's booleans are not the whole request when a saved list is picked:
  // without its own clauses the endpoint answers for the whole district inside
  // the ring, and the draw step prints that as the exact count it commits to.
  it('sends a picked list’s own clauses with the address preview', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [
        {
          id: 4,
          name: 'Persuasion walk list',
          supportStatus: ['undecided'],
          precincts: ['Sangamon|14'],
          // `id` and `voterFileFilterId` are on the wire — activityConditions
          // is a Prisma relation and gp-api returns the rows whole — but the
          // client type models only the three fields the request grammar
          // names. They are here so the normalisation is actually exercised.
          activityConditions: [
            {
              id: 'row-1',
              voterFileFilterId: 4,
              outreachType: 'text',
              outreachId: 12,
              actions: ['responded'],
            },
          ] as unknown as SegmentResponse['activityConditions'],
        },
      ],
    })

    render(surface())
    await waitFor(() => expect(flowProps.current?.savedLists).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'pick list 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'show addresses' }))

    await waitFor(() => expect(previewCalls.count).toBe(1))
    expect(previewCalls.bodies[0]?.filters).toMatchObject({
      supportStatus: ['undecided'],
      precincts: ['Sangamon|14'],
      activityConditions: [
        { outreachType: 'text', outreachId: 12, actions: ['responded'] },
      ],
    })
  })

  // An accepted recommendation is the same gap from the other side: it is a
  // list that does not exist yet, so there is no saved row to read its
  // clauses off, and precincts are the ONLY thing that narrows a door list.
  // Without them this endpoint answers for the whole district inside the ring
  // and the draw step prints that as the count the paid route is built from —
  // and its `stops` is what the hard stop cap is checked against.
  it('sends an accepted recommendation’s own clauses with the address preview', async () => {
    render(surface())

    fireEvent.click(
      screen.getByRole('button', { name: 'accept recommendation' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'show addresses' }))

    await waitFor(() => expect(previewCalls.count).toBe(1))
    expect(previewCalls.bodies[0]?.filters).toMatchObject({
      precincts: ['Cook|101', 'Cook|102'],
      supportStatus: ['undecided'],
    })
  })

  // The hand-cut selection is the third source of a precinct clause, and the
  // one door knocking had no control for at all. It reaches the same payload
  // the other two do, or the drawn shape prices a district the list will not
  // target.
  it('sends a hand-cut precinct selection with the address preview', async () => {
    render(surface({ precincts: ['Laramie|14'] }))

    fireEvent.click(screen.getByRole('button', { name: 'show addresses' }))

    await waitFor(() => expect(previewCalls.count).toBe(1))
    expect(previewCalls.bodies[0]?.filters).toMatchObject({
      precincts: ['Laramie|14'],
    })
  })

  it('sends no list clauses when the draft is nobody’s saved list', async () => {
    render(surface())

    fireEvent.click(screen.getByRole('button', { name: 'show addresses' }))

    await waitFor(() => expect(previewCalls.count).toBe(1))
    const { filters } = previewCalls.bodies[0] as {
      filters: Record<string, unknown>
    }
    expect(filters.supportStatus).toBeUndefined()
    expect(filters.activityConditions).toBeUndefined()
    expect(filters.precincts).toBeUndefined()
  })

  // The gate itself: asked of the assembled payload rather than the boolean
  // draft, because a list's support-status clause is exactly what the draft
  // cannot hold — and exactly what can empty it.
  it('asks whether a picked list keeps anybody, with the list’s own clauses', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [emptiableList],
    })
    mockAudienceCheck(true)

    render(surface())
    await waitFor(() => expect(flowProps.current?.savedLists).toHaveLength(1))
    expect(audienceCalls.count).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'pick list 4' }))

    await waitFor(() => expect(flowProps.current?.audienceEmpty).toBe(true))
    expect(audienceCalls.bodies[0]?.filters).toMatchObject({
      supportStatus: ['undecided'],
    })
    // No shape is sent, and none is relevant — an empty id-set is empty for
    // every polygon, which is what lets this be asked two steps early.
    expect(audienceCalls.bodies[0]).not.toHaveProperty('geoPoly')
  })

  // A draft carrying none of the three id-resolving criteria cannot come back
  // empty, so the round trip's answer is known before it is made.
  it('asks nothing for a draft that cannot resolve to nobody', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 4, name: 'Democrats', partyDemocrat: true }],
    })

    render(surface({ filters: { partyDemocrat: true } }))

    await waitFor(() => expect(flowProps.current?.savedLists).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'pick list 4' }))

    await waitFor(() => expect(previewCalls.count).toBe(0))
    expect(audienceCalls.count).toBe(0)
    expect(flowProps.current?.audienceEmpty).toBe(false)
  })

  // The failure mode this gate must not have. Its own empty message sends the
  // candidate to contacts to fix the list, so the answer is guaranteed to go
  // out of date between one visit and the next — and a held `true` would then
  // refuse a list that now keeps people, which is worse than the bug the gate
  // fixes. Leaving the surface must drop the answer, not bank it.
  it('does not hold a stale “empty” against a list that has since been fixed', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [emptiableList],
    })
    mockAudienceCheck(true)

    const view = render(surface())
    await waitFor(() => expect(flowProps.current?.savedLists).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'pick list 4' }))
    await waitFor(() => expect(flowProps.current?.audienceEmpty).toBe(true))

    // Off to contacts to widen the list, and back to the flow. The query
    // client is deliberately NOT cleared: surviving this unmount is the whole
    // question, and the cache is what would have survived it.
    view.unmount()
    mockAudienceCheck(false)

    render(surface())
    await waitFor(() => expect(flowProps.current?.savedLists).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'pick list 4' }))

    await waitFor(() => expect(audienceCalls.count).toBe(1))
    expect(flowProps.current?.audienceEmpty).toBe(false)
  })

  // Advisory, so it fails open. A candidate is never held out of their own
  // flow by this check: the create's own refusal is still behind it, and the
  // cost of missing an empty audience is the status quo while the cost of a
  // false block is a list that cannot be cut at all.
  it('lets the flow through when the check itself fails', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [emptiableList],
    })
    api.mock('POST /v1/door-knocking/audience-check', () => {
      audienceCalls.count += 1
      return { status: 500, data: { message: 'boom' } }
    })

    render(surface())
    await waitFor(() => expect(flowProps.current?.savedLists).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'pick list 4' }))

    await waitFor(() => expect(audienceCalls.count).toBeGreaterThan(0))
    expect(flowProps.current?.audienceEmpty).toBe(false)
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
  const Probe = () => {
    const draw = useCreateListDraw()
    return (
      <div
        data-testid="draw"
        data-start={String(draw.startDrawToken)}
        data-clear={String(draw.clearDrawToken)}
        data-undo={String(draw.undoDrawToken)}
        data-points={String(draw.pointCount)}
        data-color={draw.drawColor}
        data-frame={String(draw.frameDrawToken)}
        data-frame-bottom={String(draw.frameDrawBottomPct)}
        data-full={String(draw.fullScreen)}
      >
        <button type="button" onClick={draw.startDrawing}>
          start
        </button>
        <button type="button" onClick={() => draw.setFullScreen(true)}>
          open the map
        </button>
        <button type="button" onClick={() => draw.setFullScreen(false)}>
          leave the map
        </button>
        <button type="button" onClick={draw.clearDrawing}>
          clear drawing
        </button>
        <button type="button" onClick={draw.undoPoint}>
          undo
        </button>
        <button type="button" onClick={() => draw.onPointCount(1)}>
          place a point
        </button>
      </div>
    )
  }

  // Whether the map is uncovered is a fact about the CANVAS, which outlives
  // the flow — the same rule the draw tokens follow. The windowed preview on
  // the draw step and the drawing surface are one map in two states, so the
  // component that switches between them cannot be the one that remembers.
  it('holds whether the map is uncovered, and clears it with the shape', () => {
    render(<Probe />)
    expect(screen.getByTestId('draw')).toHaveAttribute('data-full', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'open the map' }))
    expect(screen.getByTestId('draw')).toHaveAttribute('data-full', 'true')

    // Leaving the flow entirely puts the surface back down, which a component
    // that was unmounted would get for free.
    fireEvent.click(screen.getByRole('button', { name: 'clear drawing' }))
    expect(screen.getByTestId('draw')).toHaveAttribute('data-full', 'false')
  })

  // Uncovering the map is what asks for the shape back in view: the camera has
  // not moved, but a candidate who has been reading a form for a minute has no
  // idea where their boundary is. Not fired by the ring changing — while they
  // draw, the canvasser is the one aiming the camera.
  it('asks for a fit on the way onto the map, and not on the way off it', () => {
    render(<Probe />)
    expect(screen.getByTestId('draw')).toHaveAttribute('data-frame', '0')

    fireEvent.click(screen.getByRole('button', { name: 'open the map' }))
    expect(screen.getByTestId('draw')).toHaveAttribute('data-frame', '1')

    fireEvent.click(screen.getByRole('button', { name: 'leave the map' }))
    expect(screen.getByTestId('draw')).toHaveAttribute('data-frame', '1')
  })

  // Nothing covers the map on the drawing surface in 2.0 — the chrome floats
  // over it rather than taking a band of it — so the ring is fitted into the
  // whole of the map rather than into whatever a sheet left uncovered.
  it('pads the fit against the whole map', () => {
    render(<Probe />)

    expect(screen.getByTestId('draw')).toHaveAttribute('data-frame-bottom', '0')
  })

  // The colour is auto-assigned rather than picked — the confirm step is a
  // single name field now — but it is still the map's to know, because the
  // canvas tints the boundary with it while the shape is being cut. Leaving
  // the flow has to put it back by hand, for the same reason the surface does.
  it('holds the assigned colour, and resets it when the flow is left', () => {
    render(<Probe />)
    expect(screen.getByTestId('draw')).toHaveAttribute('data-color', '#2563eb')

    fireEvent.click(screen.getByRole('button', { name: 'clear drawing' }))
    expect(screen.getByTestId('draw')).toHaveAttribute('data-color', '#2563eb')
  })

  it('bumps undo, start and clear-drawing on their own tokens', () => {
    render(<Probe />)

    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'clear drawing' }))

    expect(screen.getByTestId('draw')).toHaveAttribute('data-undo', '1')
    expect(screen.getByTestId('draw')).toHaveAttribute('data-clear', '1')
    expect(screen.getByTestId('draw')).toHaveAttribute('data-start', '0')

    // A fresh drawing session is its own request, never a side effect of one
    // of the others: bumping start alongside clear would run deleteAll after
    // draw_polygon was entered and kill the session it had just opened.
    fireEvent.click(screen.getByRole('button', { name: 'start' }))
    expect(screen.getByTestId('draw')).toHaveAttribute('data-start', '1')
    expect(screen.getByTestId('draw')).toHaveAttribute('data-clear', '1')
  })

  it('reports the point count the canvas hands it', () => {
    render(<Probe />)

    fireEvent.click(screen.getByRole('button', { name: 'place a point' }))

    expect(screen.getByTestId('draw')).toHaveAttribute('data-points', '1')
  })
})
