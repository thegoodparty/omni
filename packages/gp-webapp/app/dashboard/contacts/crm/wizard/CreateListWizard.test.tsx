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

    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()
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
  // entirely — a 2-step flow that opens directly on the constituent filters.
  it('opens Serve directly on the constituent filters step with no activity option', () => {
    setContext({ isWinContext: false, isElectedOfficial: true })
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    expect(
      screen.getByRole('heading', { name: 'Build a constituent list' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    expect(
      screen.queryByRole('radio', { name: /previous campaign activity/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Back' }),
    ).not.toBeInTheDocument()
  })

  it('advances Serve to the name step as Step 2 of 2, with Back returning to filters', async () => {
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

    expect(
      screen.getByRole('heading', { name: 'Name your list' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      screen.getByRole('heading', { name: 'Build a constituent list' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
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

  it('persists the live count as voterCount on create (ENG-10769)', async () => {
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

    // Wait for the debounced live count to land in the build button so the
    // submit below can't race the count fetch and silently omit voterCount.
    await user.click(
      await screen.findByRole('button', { name: /build your list \(250\)/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Counted list')
    await clickSaveList(user)

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      name: 'Counted list',
      voterCount: 250,
    })
  })

  it('renders a fenced count as "10,000+" and omits voterCount on create (ENG-10804)', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/count', {
      status: 200,
      data: { count: 10000, fenced: true },
    })
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 103, name: 'Fenced list' } }
    })

    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))

    // A fence floor never reads as an exact figure — "10,000+", not "10,000".
    await user.click(
      await screen.findByRole('button', {
        name: /build your list \(10,000\+\)/i,
      }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Fenced list')
    await clickSaveList(user)

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({ name: 'Fenced list' })
    // Persisting a fenced count as an exact voterCount would display a
    // permanently wrong number — omitted like an unsettled count.
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
