import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import CreateListWizard from './CreateListWizard'
import { useContactsTable } from '../ContactsTableProvider'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// deck.gl and maplibre don't run in jsdom. The stub exposes the ring it was
// handed and offers a button per scripted tap, so the boundary step can be
// walked the way it is drawn.
const BOUNDARY_TAPS: Array<[number, number]> = [
  [-85.62, 44.75],
  [-85.6, 44.75],
  [-85.61, 44.77],
]
vi.mock('../map/ContactListMap', () => ({
  __esModule: true,
  default: function ContactListMapStub({
    people,
    contactPoints,
    drawRing,
    otherRings,
    onDrawRingChange,
  }: {
    people?: unknown[]
    contactPoints?: unknown[]
    drawRing?: Array<[number, number]>
    otherRings?: Array<Array<[number, number]>>
    onDrawRingChange?: (ring: Array<[number, number]>) => void
  }) {
    return (
      <div
        data-testid="contact-map-stub"
        data-people={(contactPoints ?? people ?? []).length}
        data-ring={JSON.stringify(drawRing ?? [])}
        data-other-rings={JSON.stringify(otherRings ?? [])}
        data-draw-enabled={String(Boolean(onDrawRingChange))}
      >
        {/* Only the writable map offers taps. The boundary step's preview
            gets the same stub with no writer, and two sets of identically
            named buttons would make every query ambiguous. */}
        {onDrawRingChange &&
          BOUNDARY_TAPS.map((tap, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onDrawRingChange([...(drawRing ?? []), tap])}
            >
              {`place point ${index + 1}`}
            </button>
          ))}
      </div>
    )
  },
}))

// The boundary step's dots: the list being built, from POST
// /v1/contacts/points. Answered in the shared beforeEach because the step
// renders "Loading map…" in place of the map until it resolves, and several
// tests reach the step and then look for the map.
const mockBoundaryPoints = () =>
  api.mock('POST /v1/contacts/points', {
    status: 200,
    data: { points: [], truncated: false },
  })

const mockDistrictPeople = () =>
  api.mock('GET /v1/contacts', {
    status: 200,
    data: {
      people: [],
      pagination: {
        totalResults: 0,
        currentPage: 1,
        pageSize: 20,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    },
  })

// Serve's boundary step sits between the conditions and the name, and is
// skippable — Continue is live with no shape.
const skipBoundaryStep = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> => {
  await user.click(await screen.findByRole('button', { name: 'Continue' }))
}

// The shape is cut full-screen: the step itself carries a read-only preview
// and a CTA into the overlay, and the ring only reaches the wizard on Save.
const drawBoundary = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> => {
  await user.click(
    await screen.findByRole('button', { name: /draw an area|edit area/i }),
  )
  for (const label of ['place point 1', 'place point 2', 'place point 3']) {
    await user.click(await screen.findByRole('button', { name: label }))
  }
  await user.click(await screen.findByRole('button', { name: 'Save' }))
}

const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseSnackbar = vi.mocked(useSnackbar)

type ContextValue = ReturnType<typeof useContactsTable>

const refreshCustomSegments = vi.fn().mockResolvedValue(undefined)
const successSnackbar = vi.fn()
const errorSnackbar = vi.fn()
const selectList = vi.fn()

const setContext = (overrides: Partial<ContextValue> = {}) => {
  mockedUseContactsTable.mockReturnValue({
    isElectedOfficial: false,
    isWinContext: true,
    isWinContextReady: true,
    refreshCustomSegments,
    selectList,
    customSegments: [],
    ...overrides,
  } as ContextValue)
}

// ENG-10721 (bottom-drawer/pill-toggle prototype parity): the voter-file
// branch's checkbox rows became ToggleGroup pills, whose accessible name is
// just the option's own label text (no more sibling-text lookup needed).
const pillForOption = (label: string): HTMLElement =>
  screen.getByRole('button', { name: label })

// ENG-10769: canSubmit gates Save on the settled live count (useListWizardCount
// reports a pending debounce as isStale), so Save only enables once the count
// for the current selection has settled and then stays enabled — no trailing
// refetch re-disables it mid-click, so a plain wait-for-enabled-then-click is
// race-free. 10s, not waitFor's 1s default: toggling several pills restarts
// the 600ms debounce each time and CI runners pushed the resolve past 1s.
const clickSaveList = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> => {
  const save = screen.getByRole('button', { name: 'Save list' })
  await vi.waitFor(() => expect(save).toBeEnabled(), { timeout: 10_000 })
  await user.click(save)
}

// ENG-10767: stage Viewed/Completed events fire alongside the outcome
// events, so assertions filter by event name instead of counting every
// trackEvent call.
const eventCalls = (event: string) =>
  vi.mocked(trackEvent).mock.calls.filter(([name]) => name === event)

beforeEach(() => {
  api.reset()
  vi.clearAllMocks()
  refreshCustomSegments.mockClear()
  successSnackbar.mockClear()
  errorSnackbar.mockClear()
  mockedUseSnackbar.mockReturnValue({
    successSnackbar,
    errorSnackbar,
    displaySnackbar: vi.fn(),
  })
  setContext()
  api.mock('GET /v1/outreach', { status: 200, data: [] })
  api.mock('POST /v1/contacts/count', { status: 200, data: { count: 250 } })
  // Answered so it never reaches the network. Left unhandled it passes
  // through, fails, and retries on a ~1s backoff, re-rendering the step
  // partway through a test for no reason any assertion here is about.
  // Precinct itself is covered by PrecinctFilter and usePrecinctOptions.
  api.mock('GET /v1/contacts/precincts', {
    status: 200,
    data: { options: [], truncated: false },
  })
  mockDistrictPeople()
  mockBoundaryPoints()
  api.mock('POST /v1/contacts/polygon-preview', {
    status: 200,
    data: { count: 120, audienceEmpty: false },
  })
})

describe('CreateListWizard — step navigation', () => {
  it('disables Continue on step 1 until a branch is chosen', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    const next = screen.getByRole('button', { name: 'Continue' })
    expect(next).toBeDisabled()

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    expect(next).toBeEnabled()
  })

  it('advances to the voter-file step 2 and back to step 1', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('heading', { name: 'Filters' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    ).toBeInTheDocument()
  })

  it('shares one mode-aware step-2 heading across both branches (Win)', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      screen.getByRole('heading', { name: 'Build a voter list' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(
      screen.getByRole('radio', {
        name: /build a list from previous campaign activity/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      screen.getByRole('heading', { name: 'Build a voter list' }),
    ).toBeInTheDocument()
  })

  it('keeps the Win wizard at three steps with both branch cards', () => {
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    // Stepper's own "Step X of Y" label was retired; position is read off
    // the accessible progressbar attributes now. valuemin=0 is pinned
    // because the a11y percentage math depends on it — reverting it to 1
    // would make screen readers announce step 1 of 3 as 0%.
    const stepper = screen.getByRole('progressbar', { name: 'Progress' })
    expect(stepper).toHaveAttribute('aria-valuenow', '1')
    expect(stepper).toHaveAttribute('aria-valuemax', '3')
    expect(stepper).toHaveAttribute('aria-valuemin', '0')
    expect(
      screen.getByRole('radio', {
        name: /build a list from previous campaign activity/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    ).toBeInTheDocument()
  })

  // ENG-10750: Serve has no outreach, so its wizard drops the branch chooser
  // entirely — it opens directly on the constituent filters. The boundary
  // step then makes it three, and Win's stays at three of its own.
  it('opens Serve directly on the constituent filters step with no activity option', () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    expect(
      screen.getByRole('heading', { name: 'Build a constituent list' }),
    ).toBeInTheDocument()
    const stepper = screen.getByRole('progressbar', { name: 'Progress' })
    expect(stepper).toHaveAttribute('aria-valuenow', '1')
    expect(stepper).toHaveAttribute('aria-valuemax', '3')
    expect(
      screen.queryByRole('radio', { name: /previous campaign activity/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Back' }),
    ).not.toBeInTheDocument()
  })

  it('gives Serve a boundary step between the conditions and the name, and Win none', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    const user = userEvent.setup()
    const { unmount } = render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )

    expect(
      screen.getByRole('heading', {
        name: 'What area should this list cover?',
      }),
    ).toBeInTheDocument()
    unmount()

    setContext({ isWinContext: true, isElectedOfficial: false })
    render(<CreateListWizard open onOpenChange={vi.fn()} />)
    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )

    expect(
      screen.getByRole('heading', { name: 'Name your list' }),
    ).toBeInTheDocument()
  })

  // The whole point of POST /v1/contacts/points. The step used to draw
  // ALL_SEGMENTS — the district's entire contactable universe — under a pill
  // counting only the filtered audience, so a shape around visible dots came
  // back holding fewer people than it enclosed.
  it('draws the list being built, asking for it with the same filters the count uses', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    const bodies: Record<string, unknown>[] = []
    api.mock('POST /v1/contacts/points', ({ body }) => {
      bodies.push(body as Record<string, unknown>)
      return {
        status: 200,
        data: {
          points: [
            { id: 'a', lat: 44.76, lng: -85.62 },
            { id: 'b', lat: 44.77, lng: -85.63 },
          ],
          truncated: false,
        },
      }
    })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )

    const map = await screen.findByTestId('contact-map-stub')
    expect(map).toHaveAttribute('data-people', '2')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      filters: expect.objectContaining({ genderFemale: true }),
    })
  })

  it('advances Serve to the name step as Step 3 of 3, with Back returning through the boundary', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(pillForOption('Female'))
    // 86ajrth65: the CTA is disabled/loading (spinner, no number) until the
    // count settles, so the click must wait for the settled label — the
    // default MSW count mock (250).
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await skipBoundaryStep(user)

    expect(
      screen.getByRole('heading', { name: 'Name your list' }),
    ).toBeInTheDocument()
    const nameStepper = screen.getByRole('progressbar', { name: 'Progress' })
    expect(nameStepper).toHaveAttribute('aria-valuenow', '3')
    expect(nameStepper).toHaveAttribute('aria-valuemax', '3')

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      screen.getByRole('heading', {
        name: 'What area should this list cover?',
      }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      screen.getByRole('heading', { name: 'Build a constituent list' }),
    ).toBeInTheDocument()
    const filtersStepper = screen.getByRole('progressbar', { name: 'Progress' })
    expect(filtersStepper).toHaveAttribute('aria-valuenow', '1')
    expect(filtersStepper).toHaveAttribute('aria-valuemax', '3')
  })

  it('keeps the drawn ring when Back returns to the boundary step', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await drawBoundary(user)
    expect(screen.getByTestId('contact-map-stub')).toHaveAttribute(
      'data-other-rings',
      JSON.stringify([BOUNDARY_TAPS]),
    )

    const continueButton = await screen.findByRole('button', {
      name: 'Continue',
    })
    await vi.waitFor(() => expect(continueButton).toBeEnabled(), {
      timeout: 10_000,
    })
    await user.click(continueButton)
    expect(
      screen.getByRole('heading', { name: 'Name your list' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('contact-map-stub')).toHaveAttribute(
      'data-other-rings',
      JSON.stringify([BOUNDARY_TAPS]),
    )
  })

  it('advances to the activity step 2 and disables the step-2 CTA until every row has a channel', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list from previous campaign activity/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const cta = screen.getByRole('button', { name: /build your list/i })
    expect(cta).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: 'Text' }))
    // 86ajrth65: selecting a channel starts the (now-enabled) count query,
    // which is itself loading/disabled until it settles — wait for that
    // rather than asserting synchronously.
    await vi.waitFor(() => expect(cta).toBeEnabled(), { timeout: 10_000 })
  })

  it('resets all state when reopened after being cancelled', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <CreateListWizard open onOpenChange={onOpenChange} />,
    )

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    rerender(<CreateListWizard open={false} onOpenChange={onOpenChange} />)
    rerender(<CreateListWizard open onOpenChange={onOpenChange} />)

    expect(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    ).toBeInTheDocument()
  })
})

describe('CreateListWizard — voter-file branch payload assembly', () => {
  it('sends the exact demographic + support-status request body', async () => {
    const user = userEvent.setup()
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 101, name: 'Likely Dem women' } }
    })
    const onOpenChange = vi.fn()

    render(<CreateListWizard open onOpenChange={onOpenChange} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.click(pillForOption('Female'))
    await user.click(pillForOption('Democrat'))
    await user.click(pillForOption('Supporter'))

    // 86ajrth65: wait for the CTA's settled label — it's disabled/loading
    // until the count resolves.
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Likely Dem women')
    await clickSaveList(user)

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      name: 'Likely Dem women',
      genderFemale: true,
      partyDemocrat: true,
      supportStatus: ['supporter'],
    })
    expect(sentBody).not.toHaveProperty('activityConditions')

    await vi.waitFor(() => expect(refreshCustomSegments).toHaveBeenCalled())
    await vi.waitFor(() => expect(selectList).toHaveBeenCalledWith(101))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not persist a voterCount on create', async () => {
    const user = userEvent.setup()
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 102, name: 'Counted list' } }
    })

    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))

    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Counted list')
    await clickSaveList(user)

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({ name: 'Counted list' })
    // The stored voterCount was retired — the outreach send count is the
    // authoritative number now, so the wizard never persists a filter count.
    expect(sentBody).not.toHaveProperty('voterCount')
  })

  it('keeps the build CTA (and so the whole flow) blocked while the live count never resolves (ENG-10769/86ajrth65)', async () => {
    const user = userEvent.setup()
    // A count that never settles: pre-86ajrth65, this test reached the name
    // step (the CTA stayed clickable while loading) to prove Save itself
    // gated on the unresolved count — the exact voterCount-omission bug
    // ENG-10769 fixes. 86ajrth65 moved that same guard a step earlier: the
    // CTA's own `loading={isCounting}` state now blocks progress until the
    // count settles, so the old race (reach the name step, then Save, with
    // an unresolved count) can no longer happen — the flow can't leave this
    // step at all.
    api.mock(
      'POST /v1/contacts/count',
      () => new Promise<never>(() => undefined),
    )

    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))

    const cta = await screen.findByRole('button', { name: 'Build your list' })
    await vi.waitFor(() => expect(cta).toHaveAttribute('data-loading', 'true'))
    expect(cta).toBeDisabled()

    // Programmatic activation must not advance either — the guard isn't
    // just the disabled prop.
    fireEvent.click(cta)
    expect(screen.queryByLabelText(/list name/i)).not.toBeInTheDocument()
  })

  it('hides the Political Party section for an elected official', async () => {
    setContext({ isElectedOfficial: true })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      screen.queryByRole('heading', { name: /political party/i }),
    ).not.toBeInTheDocument()
  })

  it('shows "Clear filters" only once a pill is selected, and clearing resets the payload', async () => {
    const user = userEvent.setup()
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 999, name: 'Cleared list' } }
    })

    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      screen.queryByRole('button', { name: 'Clear filters' }),
    ).not.toBeInTheDocument()

    const femalePill = pillForOption('Female')
    await user.click(femalePill)
    expect(femalePill).toHaveAttribute('data-state', 'on')
    expect(
      screen.getByRole('button', { name: 'Clear filters' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(femalePill).toHaveAttribute('data-state', 'off')
    expect(
      screen.queryByRole('button', { name: 'Clear filters' }),
    ).not.toBeInTheDocument()

    // The cleared state actually reaches the submit payload, not just the
    // UI — a fresh selection re-enables the build (ENG-10751 blocks an
    // all-cleared submit), and the earlier Female toggle stays cleared.
    await user.click(pillForOption('Democrat'))
    // 86ajrth65: wait for the settled label — disabled/loading until then.
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Cleared list')
    await clickSaveList(user)

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      genderFemale: false,
      partyDemocrat: true,
    })
  })
})

describe('CreateListWizard — activity branch payload assembly', () => {
  it('fires no count request while the activity selection is incomplete', async () => {
    const countHandler = vi.fn(() => ({
      status: 200 as const,
      data: { count: 250 },
    }))
    api.mock('POST /v1/contacts/count', countHandler)
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list from previous campaign activity/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // An incomplete condition serializes to activityConditions: [] — the
    // backend would return the unfiltered total and poison the count cache.
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(countHandler).not.toHaveBeenCalled()

    await user.click(screen.getByRole('radio', { name: 'Text' }))
    await vi.waitFor(() => expect(countHandler).toHaveBeenCalled())
  })

  it('sends two stacked conditions in the exact API shape (AC example)', async () => {
    api.mock('GET /v1/outreach', {
      status: 200,
      data: [
        {
          id: 55,
          campaignId: 1,
          outreachType: 'text',
          status: 'completed',
          name: 'GOTV blast',
        },
      ],
    })
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 202, name: 'Text + door knock' } }
    })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list from previous campaign activity/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // Condition 1: text · GOTV blast · no response (outcomes live behind the
    // "Filter on activity" progressive reveal since ENG-10725)
    await user.click(screen.getByRole('radio', { name: 'Text' }))
    await user.click(await screen.findByRole('radio', { name: 'GOTV blast' }))
    await user.click(screen.getByRole('button', { name: 'Filter on activity' }))
    await user.click(screen.getByText('No Response'))

    // Condition 2: door knocking · any · support yes
    await user.click(screen.getByRole('button', { name: 'Add condition' }))
    const doorKnockRadios = screen.getAllByRole('radio', {
      name: 'Door Knocking',
    })
    await user.click(doorKnockRadios[doorKnockRadios.length - 1]!)
    await user.click(screen.getByRole('button', { name: 'Filter on activity' }))
    await user.click(screen.getByText('Support: Yes'))

    // 86ajrth65: the CTA is disabled/loading until the count settles —
    // wait for the settled label before asserting/clicking.
    const cta = await screen.findByRole(
      'button',
      { name: /build your list \(250\)/i },
      { timeout: 10_000 },
    )
    expect(cta).toBeEnabled()
    await user.click(cta)
    await user.type(screen.getByLabelText(/list name/i), 'Text + door knock')
    await clickSaveList(user)

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      name: 'Text + door knock',
      activityConditions: [
        { outreachType: 'text', outreachId: 55, actions: ['no_response'] },
        {
          outreachType: 'doorKnocking',
          outreachId: null,
          actions: ['support_yes'],
        },
      ],
    })
    expect(sentBody).not.toHaveProperty('supportStatus')
  })
})

describe('CreateListWizard — running total + CTA', () => {
  it('shows the debounced count on the step-2 CTA and in the step-3 count sentence', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))

    const cta = await screen.findByRole('button', {
      name: /build your list \(250\)/i,
    })
    expect(cta).toBeInTheDocument()

    await user.click(cta)
    expect(await screen.findByText(/250 voters match/i)).toBeInTheDocument()
  })

  it('surfaces the 100k-cap error as guidance rather than a crash', async () => {
    api.mock('POST /v1/contacts/count', {
      status: 400,
      data: {
        message: 'This filter resolves too many people to apply directly',
      },
    })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))

    // 86ajrth65 + isCounting isError fix: a count that terminally errors on
    // its very first fetch must NOT leave the CTA stuck in the loading
    // state forever — once the query settles into its error, the CTA
    // re-enables with the bare (no-number) label, same as any other
    // settled state. Locks in the regression this ticket's isCounting fix
    // closed.
    const cta = await screen.findByRole('button', { name: 'Build your list' })
    await vi.waitFor(() => expect(cta).toHaveAttribute('data-loading', 'false'))
    expect(cta).toBeEnabled()

    await user.click(cta)

    expect(await screen.findByText(/too many people/i)).toBeInTheDocument()
    // The build button must still be usable once named — the cap is
    // guidance, not a hard submit-block (the create endpoint doesn't
    // resolve/cap at save time).
    await user.type(screen.getByLabelText(/list name/i), 'Huge list')
    // Save enables once the count settles — even on a cap error, which just
    // omits voterCount (the count is a nice-to-have, not a submit-block). The
    // stale seed count can surface the cap message a beat before the debounce
    // settles, so wait for the gate to open rather than reading it synchronously.
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save list' })).toBeEnabled(),
    )
  })
})

describe('CreateListWizard — ENG-10751 zero-filter build block', () => {
  it('renders a truly disabled build CTA at zero selections that cannot advance to the name step', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const cta = await screen.findByRole('button', {
      name: /build your list/i,
    })
    expect(cta).toBeDisabled()

    // Programmatic activation (the old opacity-50 hack let this through):
    // a raw dispatched click on the disabled button must not advance either.
    fireEvent.click(cta)
    expect(screen.queryByLabelText(/list name/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Filters' })).toBeInTheDocument()
  })

  it('enables on a single selection and disables again after Clear filters', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const cta = await screen.findByRole('button', {
      name: /build your list/i,
    })
    expect(cta).toBeDisabled()

    await user.click(pillForOption('Female'))
    // 86ajrth65: selecting a pill restarts the debounce, so the CTA is
    // loading/disabled again until the count resettles for the new payload.
    await vi.waitFor(() => expect(cta).toBeEnabled(), { timeout: 10_000 })

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(cta).toBeDisabled()
  })

  it('keeps the count query firing at zero selections so the disabled CTA shows the unfiltered total', async () => {
    const countHandler = vi.fn(() => ({
      status: 200 as const,
      data: { count: 118099 },
    }))
    api.mock('POST /v1/contacts/count', countHandler)
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await vi.waitFor(() => expect(countHandler).toHaveBeenCalled())
    const cta = await screen.findByRole('button', {
      name: /build your list \(118,099\)/i,
    })
    expect(cta).toBeDisabled()
  })
})

describe('CreateListWizard — ENG-10781 zero-match build block', () => {
  it('disables the build CTA once a valid selection resolves to zero matches', async () => {
    api.mock('POST /v1/contacts/count', { status: 200, data: { count: 0 } })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))

    // 10s: the same debounce-tolerant wait clickSaveList uses — toggling the
    // pill restarts the 600ms debounce before this zero count can land.
    const cta = await screen.findByRole(
      'button',
      { name: /build your list \(0\)/i },
      { timeout: 10_000 },
    )
    await vi.waitFor(() => expect(cta).toBeDisabled(), { timeout: 10_000 })

    // Programmatic activation must not advance either (mirrors the
    // ENG-10751 zero-selection guard directly above).
    fireEvent.click(cta)
    expect(screen.queryByLabelText(/list name/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Filters' })).toBeInTheDocument()
  })

  it('re-enables the build CTA once the selection matches people', async () => {
    api.mock('POST /v1/contacts/count', ({ body }) => {
      const payload = body as Record<string, unknown>
      return {
        status: 200,
        data: { count: payload.partyDemocrat ? 42 : 0 },
      }
    })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))

    const zeroCta = await screen.findByRole(
      'button',
      { name: /build your list \(0\)/i },
      { timeout: 10_000 },
    )
    await vi.waitFor(() => expect(zeroCta).toBeDisabled(), { timeout: 10_000 })

    await user.click(pillForOption('Democrat'))

    const matchedCta = await screen.findByRole(
      'button',
      { name: /build your list \(42\)/i },
      { timeout: 10_000 },
    )
    await vi.waitFor(() => expect(matchedCta).toBeEnabled(), {
      timeout: 10_000,
    })
  })
})

describe('CreateListWizard — error handling', () => {
  it('shows an error snackbar and keeps the wizard open when create fails', async () => {
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 500,
      data: { message: 'server exploded' },
    })
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(<CreateListWizard open onOpenChange={onOpenChange} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))
    // 86ajrth65: wait for the settled label — disabled/loading until then.
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Broken list')
    await clickSaveList(user)

    await vi.waitFor(() => expect(errorSnackbar).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    // Stage Viewed/Completed events fired on the way in (ENG-10767), but a
    // failed create must emit neither the outcome nor the funnel completion.
    expect(eventCalls(EVENTS.VoterData.ListCreated)).toHaveLength(0)
    expect(eventCalls(EVENTS.Contacts.ListWizard.NameCompleted)).toHaveLength(0)
  })

  // The save freezes the shape's membership with an UNFILTERED scan where
  // the live preview applies the list's filters, so the same shape can
  // preview at a few thousand and still exceed the cap here. gp-api words
  // that refusal for whoever drew it, and a generic "Failed to create list"
  // throws away the only thing telling them to draw smaller.
  it('surfaces the cap refusal from the server rather than a generic failure', async () => {
    const capMessage =
      'This area holds too many people to count. Draw a smaller boundary ' +
      'or narrow the list.'
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 400,
      data: { message: capMessage },
    })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Too big')
    await clickSaveList(user)

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        capMessage,
        expect.objectContaining({ autoHideDuration: 6000 }),
      ),
    )
    expect(errorSnackbar).not.toHaveBeenCalledWith('Failed to create list')
  })
})

describe('CreateListWizard — ENG-10709 List Created / Activity List Created analytics', () => {
  it('fires the Win-mode List Created event once with variableCount + hasParty on a successful voter-file create', async () => {
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 101, name: 'Likely Dem women' },
    })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // gender (1 category) + political_party (1 category) + supportStatus
    // (counts as 1) = variableCount 3.
    await user.click(pillForOption('Female'))
    await user.click(pillForOption('Democrat'))
    await user.click(pillForOption('Supporter'))

    // 86ajrth65: wait for the settled label — disabled/loading until then.
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Likely Dem women')
    await clickSaveList(user)

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.VoterData.ListCreated)).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.VoterData.ListCreated, {
      variableCount: 3,
      hasParty: true,
    })
  })

  it('fires the Serve-mode List Created event without a hasParty property, and the payload carries no activityConditions', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 102, name: 'Reachable constituents' } }
    })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    // ENG-10750: no branch chooser for Serve — the wizard opens on the
    // filters step directly.
    await user.click(pillForOption('Female'))

    // 86ajrth65: wait for the settled label — disabled/loading until then.
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await skipBoundaryStep(user)
    await user.type(
      screen.getByLabelText(/list name/i),
      'Reachable constituents',
    )
    await clickSaveList(user)

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.ConstituentData.ListCreated)).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ConstituentData.ListCreated,
      { variableCount: 1 },
    )
    const [, properties] = eventCalls(EVENTS.ConstituentData.ListCreated)[0]!
    expect(properties).not.toHaveProperty('hasParty')

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      name: 'Reachable constituents',
      genderFemale: true,
    })
    expect(sentBody).not.toHaveProperty('activityConditions')
    // The boundary step is skippable, and skipping it must not write an
    // empty shape the server would then filter on.
    expect(sentBody).not.toHaveProperty('geoPoly')
  })

  it('sends the drawn boundary as a closed geoPoly on create', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 103, name: 'Riverside block' } }
    })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)
    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await drawBoundary(user)

    const continueButton = await screen.findByRole('button', {
      name: 'Continue',
    })
    await vi.waitFor(() => expect(continueButton).toBeEnabled(), {
      timeout: 10_000,
    })
    await user.click(continueButton)
    await user.type(screen.getByLabelText(/list name/i), 'Riverside block')
    await clickSaveList(user)

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      geoPoly: {
        type: 'Polygon',
        coordinates: [[...BOUNDARY_TAPS, BOUNDARY_TAPS[0]]],
      },
    })
  })

  it('shows the polygon count on the name step once a boundary is drawn', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)
    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await drawBoundary(user)

    const continueButton = await screen.findByRole('button', {
      name: 'Continue',
    })
    await vi.waitFor(() => expect(continueButton).toBeEnabled(), {
      timeout: 10_000,
    })
    await user.click(continueButton)

    // 120 is the polygon preview's answer; 250 is the pre-boundary count the
    // name step would otherwise still be quoting.
    expect(await screen.findByText(/120 constituents match/i)).toBeVisible()
    expect(
      screen.queryByText(/250 constituents match/i),
    ).not.toBeInTheDocument()
  })

  it('blocks Continue and says to move the boundary when it holds nobody', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    api.mock('POST /v1/contacts/polygon-preview', {
      status: 200,
      data: { count: 0, audienceEmpty: false },
    })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)
    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await drawBoundary(user)

    expect(await screen.findByText(/no constituents here/i)).toBeInTheDocument()
    await vi.waitFor(
      () =>
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled(),
      { timeout: 10_000 },
    )
  })

  // The save re-runs the enclosing scan UNFILTERED to freeze the shape's
  // membership, so a shape the preview refused is one the save will refuse
  // too. Letting Continue through walks the holder all the way to naming a
  // list that cannot be saved.
  it('blocks Continue when the boundary count errors rather than settling', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    api.mock('POST /v1/contacts/polygon-preview', {
      status: 400,
      data: {
        message:
          'This area holds too many people to count. Draw a smaller ' +
          'boundary or narrow the list.',
      },
    })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)
    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await drawBoundary(user)

    expect(
      await screen.findByText(/too many people to count/i),
    ).toBeInTheDocument()
    await vi.waitFor(
      () =>
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled(),
      { timeout: 10_000 },
    )
  })

  it('says the filters match nobody rather than blaming the boundary', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    api.mock('POST /v1/contacts/polygon-preview', {
      status: 200,
      data: { count: 0, audienceEmpty: true },
    })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)
    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await drawBoundary(user)

    expect(
      await screen.findByText(/no constituents match your filters yet/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/no constituents here/i)).not.toBeInTheDocument()
  })

  it('fires the Win-mode Activity List Created event with sourceCampaign + actionFilter for a single condition', async () => {
    api.mock('GET /v1/outreach', {
      status: 200,
      data: [
        {
          id: 55,
          campaignId: 1,
          outreachType: 'text',
          status: 'completed',
          name: 'GOTV blast',
        },
      ],
    })
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 202, name: 'Texted GOTV blast' },
    })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list from previous campaign activity/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.click(screen.getByRole('radio', { name: 'Text' }))
    await user.click(await screen.findByRole('radio', { name: 'GOTV blast' }))
    await user.click(screen.getByRole('button', { name: 'Filter on activity' }))
    await user.click(screen.getByText('No Response'))

    // 86ajrth65: wait for the settled label — disabled/loading until then.
    await user.click(
      await screen.findByRole(
        'button',
        { name: /build your list \(250\)/i },
        { timeout: 10_000 },
      ),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Texted GOTV blast')
    await clickSaveList(user)

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.VoterData.ActivityListCreated)).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.VoterData.ActivityListCreated,
      { sourceCampaign: 'GOTV blast', actionFilter: ['no_response'] },
    )
  })

  it('joins sourceCampaign and dedupes actionFilter across two stacked conditions', async () => {
    api.mock('GET /v1/outreach', {
      status: 200,
      data: [
        {
          id: 55,
          campaignId: 1,
          outreachType: 'text',
          status: 'completed',
          name: 'GOTV blast',
        },
      ],
    })
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 203, name: 'Text + door knock' },
    })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list from previous campaign activity/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // Condition 1: text · GOTV blast · no response
    await user.click(screen.getByRole('radio', { name: 'Text' }))
    await user.click(await screen.findByRole('radio', { name: 'GOTV blast' }))
    await user.click(screen.getByRole('button', { name: 'Filter on activity' }))
    await user.click(screen.getByText('No Response'))

    // Condition 2: door knocking · any · support yes
    await user.click(screen.getByRole('button', { name: 'Add condition' }))
    const doorKnockRadios = screen.getAllByRole('radio', {
      name: 'Door Knocking',
    })
    await user.click(doorKnockRadios[doorKnockRadios.length - 1]!)
    await user.click(screen.getByRole('button', { name: 'Filter on activity' }))
    await user.click(screen.getByText('Support: Yes'))

    // 86ajrth65: wait for the settled label — disabled/loading until then.
    await user.click(
      await screen.findByRole(
        'button',
        { name: /build your list \(250\)/i },
        { timeout: 10_000 },
      ),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Text + door knock')
    await clickSaveList(user)

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.VoterData.ActivityListCreated)).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.VoterData.ActivityListCreated,
      {
        sourceCampaign: 'GOTV blast, any',
        actionFilter: ['no_response', 'support_yes'],
      },
    )
  })

  it('never fires outcome analytics on wizard abandon (closed via X before completing)', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Close' }))

    // Stage Viewed events legitimately fired (ENG-10767); the outcome and
    // funnel-completion events must not.
    expect(eventCalls(EVENTS.VoterData.ListCreated)).toHaveLength(0)
    expect(eventCalls(EVENTS.VoterData.ActivityListCreated)).toHaveLength(0)
    expect(eventCalls(EVENTS.Contacts.ListWizard.NameCompleted)).toHaveLength(0)
  })
})

describe('CreateListWizard — ENG-10767 stage Viewed/Completed funnel', () => {
  it('fires Method Viewed on open, Method Completed + Conditions Viewed on advance (Win)', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.ListWizard.MethodViewed)).toHaveLength(
        1,
      ),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.ListWizard.MethodViewed,
      { context: 'win' },
    )

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    // Picking a branch re-renders the branch stage — the Viewed must not
    // re-fire on that unrelated re-render.
    expect(eventCalls(EVENTS.Contacts.ListWizard.MethodViewed)).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.ListWizard.MethodCompleted,
      { context: 'win', branch: 'voterFile' },
    )
    await vi.waitFor(() =>
      expect(
        eventCalls(EVENTS.Contacts.ListWizard.ConditionsViewed),
      ).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.ListWizard.ConditionsViewed,
      { context: 'win', branch: 'voterFile' },
    )
  })

  it('re-fires the stage Viewed when navigating Back into an already-visited stage', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.ListWizard.MethodViewed)).toHaveLength(
        2,
      ),
    )
  })

  it('fires the Conditions Completed on advance to name, and Name Completed alongside List Created on save', async () => {
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 101, name: 'Funnel list' },
    })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))
    // 86ajrth65: wait for the settled label — disabled/loading until then.
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.ListWizard.ConditionsCompleted,
      { context: 'win', branch: 'voterFile' },
    )
    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.ListWizard.NameViewed)).toHaveLength(1),
    )

    await user.type(screen.getByLabelText(/list name/i), 'Funnel list')
    await clickSaveList(user)

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.ListWizard.NameCompleted)).toHaveLength(
        1,
      ),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.ListWizard.NameCompleted,
      { context: 'win', branch: 'voterFile' },
    )
    // The funnel completion and the outcome are separate events by design.
    expect(eventCalls(EVENTS.VoterData.ListCreated)).toHaveLength(1)
  })

  it('fires a fresh Method Viewed when the wizard is reopened on the same stage', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <CreateListWizard open onOpenChange={onOpenChange} />,
    )
    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.ListWizard.MethodViewed)).toHaveLength(
        1,
      ),
    )

    rerender(<CreateListWizard open={false} onOpenChange={onOpenChange} />)
    rerender(<CreateListWizard open onOpenChange={onOpenChange} />)

    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.ListWizard.MethodViewed)).toHaveLength(
        2,
      ),
    )
  })

  it('opens Serve on Conditions Viewed with branch voterFile and never fires the Method stage', async () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await vi.waitFor(() =>
      expect(
        eventCalls(EVENTS.Contacts.ListWizard.ConditionsViewed),
      ).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.ListWizard.ConditionsViewed,
      { context: 'serve', branch: 'voterFile' },
    )
    expect(eventCalls(EVENTS.Contacts.ListWizard.MethodViewed)).toHaveLength(0)
  })
})

describe('CreateListWizard — dismissed mid-mutation (vaul swipe-close path)', () => {
  it('still completes onSuccess exactly once when the drawer closes while the create is in flight', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    let resolveCreate: (data: { id: number; name: string }) => void
    const createPromise = new Promise<{ id: number; name: string }>(
      (resolve) => {
        resolveCreate = resolve
      },
    )
    api.mock('POST /v1/voters/voter-file/filter', () =>
      createPromise.then((data) => ({ status: 200 as const, data })),
    )

    const { rerender } = render(
      <CreateListWizard open onOpenChange={onOpenChange} />,
    )

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))
    // 86ajrth65: wait for the settled label — disabled/loading until then.
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Mid-mutation list')
    await clickSaveList(user)

    // Dismiss the drawer WHILE the create is still pending. A vaul swipe
    // and this X-close both funnel through the same controlled
    // onOpenChange(false) the parent owns — CreateListWizard itself never
    // unmounts on close (CrmContactsPage always renders it, only `open`
    // toggles), so its in-flight useMutation survives the dismiss.
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    rerender(<CreateListWizard open={false} onOpenChange={onOpenChange} />)

    resolveCreate!({ id: 555, name: 'Mid-mutation list' })

    // The create DID happen server-side — onSuccess must still run exactly
    // once: the analytics event, the navigation, and the success snackbar
    // all fire despite the drawer no longer being visible.
    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.VoterData.ListCreated)).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.VoterData.ListCreated, {
      variableCount: 1,
      hasParty: false,
    })
    await vi.waitFor(() => expect(selectList).toHaveBeenCalledWith(555))
    expect(selectList).toHaveBeenCalledTimes(1)
    expect(successSnackbar).toHaveBeenCalledTimes(1)
  })
})

// The voter-file count fires on every pill toggle (deliberately, ENG-10751), so
// one session on an org with no resolvable district produced 54 of the 107
// district 400s on its own.
describe('CreateListWizard — district gating', () => {
  const openVoterFileStep = async (
    user: ReturnType<typeof userEvent.setup>,
  ) => {
    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))
  }

  it('fires the count when a district resolves', async () => {
    const onCount = vi.fn()
    api.mock('POST /v1/contacts/count', () => {
      onCount()
      return { status: 200, data: { count: 250 } }
    })
    setContext({ voterDataUnavailable: false })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)
    await openVoterFileStep(user)

    await vi.waitFor(() => expect(onCount).toHaveBeenCalled(), {
      timeout: 3000,
    })
  })

  // Waits well past the hook's 600ms debounce; the control above proves the
  // request lands inside that window when the gate is open.
  it('fires no count when the district is unresolvable', async () => {
    const onCount = vi.fn()
    api.mock('POST /v1/contacts/count', () => {
      onCount()
      return { status: 200, data: { count: 250 } }
    })
    setContext({ voterDataUnavailable: true })
    const user = userEvent.setup()

    render(<CreateListWizard open onOpenChange={vi.fn()} />)
    await openVoterFileStep(user)
    await new Promise((resolve) => setTimeout(resolve, 900))

    expect(onCount).not.toHaveBeenCalled()
  })
})
