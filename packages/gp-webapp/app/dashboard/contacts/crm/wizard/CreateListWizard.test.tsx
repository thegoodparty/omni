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
    ...overrides,
  } as ContextValue)
}

// ENG-10721 (bottom-drawer/pill-toggle prototype parity): the voter-file
// branch's checkbox rows became ToggleGroup pills, whose accessible name is
// just the option's own label text (no more sibling-text lookup needed).
const pillForOption = (label: string): HTMLElement =>
  screen.getByRole('button', { name: label })

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
        name: /build my list using the voter file/i,
      }),
    )
    expect(next).toBeEnabled()
  })

  it('advances to the voter-file step 2 and back to step 1', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build my list using the voter file/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('heading', { name: 'Filters' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      screen.getByRole('radio', {
        name: /build my list using the voter file/i,
      }),
    ).toBeInTheDocument()
  })

  it('shares one mode-aware step-2 heading across both branches (Win)', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build my list using the voter file/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      screen.getByRole('heading', { name: 'Build a voter list' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(
      screen.getByRole('radio', {
        name: /build my list using outreach activity/i,
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
        name: /build my list using outreach activity/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', {
        name: /build my list using the voter file/i,
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
      screen.queryByRole('radio', { name: /outreach activity/i }),
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
    await user.click(
      await screen.findByRole('button', { name: /build your list/i }),
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
        name: /build my list using outreach activity/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const cta = screen.getByRole('button', { name: /build your list/i })
    expect(cta).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: 'Text' }))
    expect(cta).toBeEnabled()
  })

  it('resets all state when reopened after being cancelled', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <CreateListWizard open onOpenChange={onOpenChange} />,
    )

    await user.click(
      screen.getByRole('radio', {
        name: /build my list using the voter file/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    rerender(<CreateListWizard open={false} onOpenChange={onOpenChange} />)
    rerender(<CreateListWizard open onOpenChange={onOpenChange} />)

    expect(
      screen.getByRole('radio', {
        name: /build my list using the voter file/i,
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
        name: /build my list using the voter file/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.click(pillForOption('Female'))
    await user.click(pillForOption('Democrat'))
    await user.click(pillForOption('Supporter'))

    await user.click(
      await screen.findByRole('button', { name: /build your list/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Likely Dem women')
    await user.click(screen.getByRole('button', { name: 'Save list' }))

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

  it('hides the Political Party section for an elected official', async () => {
    setContext({ isElectedOfficial: true })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build my list using the voter file/i,
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
        name: /build my list using the voter file/i,
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
    await user.click(
      await screen.findByRole('button', { name: /build your list/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Cleared list')
    await user.click(screen.getByRole('button', { name: 'Save list' }))

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
        name: /build my list using outreach activity/i,
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
        name: /build my list using outreach activity/i,
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

    const cta = screen.getByRole('button', { name: /build your list/i })
    expect(cta).toBeEnabled()
    await user.click(cta)
    await user.type(screen.getByLabelText(/list name/i), 'Text + door knock')
    await user.click(screen.getByRole('button', { name: 'Save list' }))

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
        name: /build my list using the voter file/i,
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
        name: /build my list using the voter file/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: 'Build your list' }),
    )

    expect(await screen.findByText(/too many people/i)).toBeInTheDocument()
    // The build button must still be usable once named — the cap is
    // guidance, not a hard submit-block (the create endpoint doesn't
    // resolve/cap at save time).
    await user.type(screen.getByLabelText(/list name/i), 'Huge list')
    expect(screen.getByRole('button', { name: 'Save list' })).toBeEnabled()
  })
})

describe('CreateListWizard — ENG-10751 zero-filter build block', () => {
  it('renders a truly disabled build CTA at zero selections that cannot advance to the name step', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build my list using the voter file/i,
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
        name: /build my list using the voter file/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const cta = await screen.findByRole('button', {
      name: /build your list/i,
    })
    expect(cta).toBeDisabled()

    await user.click(pillForOption('Female'))
    expect(cta).toBeEnabled()

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
        name: /build my list using the voter file/i,
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
        name: /build my list using the voter file/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Broken list')
    await user.click(screen.getByRole('button', { name: 'Save list' }))

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
        name: /build my list using the voter file/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // gender (1 category) + political_party (1 category) + supportStatus
    // (counts as 1) = variableCount 3.
    await user.click(pillForOption('Female'))
    await user.click(pillForOption('Democrat'))
    await user.click(pillForOption('Supporter'))

    await user.click(
      await screen.findByRole('button', { name: /build your list/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Likely Dem women')
    await user.click(screen.getByRole('button', { name: 'Save list' }))

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

    await user.click(
      await screen.findByRole('button', { name: /build your list/i }),
    )
    await user.type(
      screen.getByLabelText(/list name/i),
      'Reachable constituents',
    )
    await user.click(screen.getByRole('button', { name: 'Save list' }))

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
        name: /build my list using outreach activity/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.click(screen.getByRole('radio', { name: 'Text' }))
    await user.click(await screen.findByRole('radio', { name: 'GOTV blast' }))
    await user.click(screen.getByRole('button', { name: 'Filter on activity' }))
    await user.click(screen.getByText('No Response'))

    await user.click(screen.getByRole('button', { name: /build your list/i }))
    await user.type(screen.getByLabelText(/list name/i), 'Texted GOTV blast')
    await user.click(screen.getByRole('button', { name: 'Save list' }))

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
        name: /build my list using outreach activity/i,
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

    await user.click(screen.getByRole('button', { name: /build your list/i }))
    await user.type(screen.getByLabelText(/list name/i), 'Text + door knock')
    await user.click(screen.getByRole('button', { name: 'Save list' }))

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
        name: /build my list using the voter file/i,
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
        name: /build my list using the voter file/i,
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
        name: /build my list using the voter file/i,
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
        name: /build my list using the voter file/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list/i }),
    )

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Contacts.ListWizard.ConditionsCompleted,
      { context: 'win', branch: 'voterFile' },
    )
    await vi.waitFor(() =>
      expect(eventCalls(EVENTS.Contacts.ListWizard.NameViewed)).toHaveLength(1),
    )

    await user.type(screen.getByLabelText(/list name/i), 'Funnel list')
    await user.click(screen.getByRole('button', { name: 'Save list' }))

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
        name: /build my list using the voter file/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(pillForOption('Female'))
    await user.click(
      await screen.findByRole('button', { name: /build your list/i }),
    )
    await user.type(screen.getByLabelText(/list name/i), 'Mid-mutation list')
    await user.click(screen.getByRole('button', { name: 'Save list' }))

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
