import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { RobocallFlow } from './RobocallFlow'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// useListWizardCount (reached only in the builder) reads the active org slug.
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))

// The CRM wizard's dumb steps have their own tests; stub them to light
// stand-ins so this test can drive RobocallFlow's builder path without
// coupling to the wizard's pill/label internals.
vi.mock('app/dashboard/contacts/crm/wizard/VoterFileStep', () => ({
  default: ({
    onSupportStatusChange,
  }: {
    onSupportStatusChange: (v: string[]) => void
  }) => (
    <button type="button" onClick={() => onSupportStatusChange(['supporter'])}>
      mock-add-filter
    </button>
  ),
}))
vi.mock('app/dashboard/contacts/crm/wizard/NameStep', () => ({
  default: ({
    name,
    onNameChange,
  }: {
    name: string
    onNameChange: (n: string) => void
  }) => (
    <input
      aria-label="mock list name"
      value={name}
      onChange={(e) => onNameChange(e.target.value)}
    />
  ),
}))

const mockSavedLists = () =>
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    data: [
      { id: 1, name: 'Renters in 98103' },
      { id: 2, name: 'All registered voters' },
    ],
  })

// robocall reads the landline count off reachability.robocall.
const mockListDetail = (robocall: number | null) =>
  api.mock('GET /v1/contacts/list-detail', {
    status: 200,
    data: {
      demographics: { people: 1000, avgAge: null, avgIncome: null },
      reachability: {
        sms: 500,
        robocall,
        phoneBanking: robocall,
        doorKnocking: 700,
        polls: 500,
      },
      outreachHistory: [],
    },
  })

const mockBuilderCount = (count: number) =>
  api.mock('POST /v1/contacts/count', { status: 200, data: { count } })

const mockCreateList = () =>
  api.mock('POST /v1/voters/voter-file/filter', {
    status: 200,
    data: { id: 99, name: 'My landline list' },
  })

const mockCreateListError = () =>
  api.mock('POST /v1/voters/voter-file/filter', {
    status: 500,
    data: { message: 'boom' },
  })

const gotoAudience = async () => {
  render(<RobocallFlow open onClose={vi.fn()} />)
  fireEvent.click(screen.getByText('Persuade likely voters'))
}

describe('RobocallFlow', () => {
  // useElectedOffice fires on mount (no enable guard); 404 => not an elected
  // official (data null), exercising the hook's real 404->null branch.
  beforeEach(() => {
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'No elected office' },
    })
  })

  it('opens on the purpose step with the robocall purposes', () => {
    mockSavedLists()
    render(<RobocallFlow open onClose={vi.fn()} />)
    expect(screen.getByText('Introduce myself')).toBeInTheDocument()
    expect(screen.getByText('Persuade likely voters')).toBeInTheDocument()
  })

  it('advances to the audience step when a purpose is selected', async () => {
    mockSavedLists()
    await gotoAudience()
    expect(
      screen.getByText(/We only call voters with a landline/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Introduce myself')).not.toBeInTheDocument()
  })

  it('returns to the purpose step on Back from the audience picker', async () => {
    mockSavedLists()
    await gotoAudience()
    fireEvent.click(screen.getByLabelText('Back'))
    expect(screen.getByText('Introduce myself')).toBeInTheDocument()
  })

  it('shows the landline reachable count and advances on Continue', async () => {
    mockSavedLists()
    mockListDetail(80)
    await gotoAudience()

    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Renters in 98103'))

    // 80 landline-reachable voters * $0.045 = $3.60
    expect(
      await screen.findByText(/Call 80 voters for \$3\.60/),
    ).toBeInTheDocument()

    const continueBtn = await screen.findByRole('button', {
      name: /Continue \(80\)/,
    })
    await userEvent.click(continueBtn)
    expect(screen.getByText('More coming soon')).toBeInTheDocument()
  })

  it('treats a null landline count as unavailable, not zero', async () => {
    mockSavedLists()
    mockListDetail(null)
    await gotoAudience()

    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Renters in 98103'))

    expect(
      await screen.findByText("We couldn't count this list right now."),
    ).toBeInTheDocument()
    // Continue stays disabled when the count is unavailable.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled(),
    )
  })

  it('enters the list builder from "Create a new list"', async () => {
    mockSavedLists()
    await gotoAudience()
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Create a new list'))
    expect(screen.getByText('Build a voter list')).toBeInTheDocument()
  })

  it('builds a list, creates it, and advances to the placeholder', async () => {
    mockSavedLists()
    mockBuilderCount(50)
    mockCreateList()
    await gotoAudience()
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Create a new list'))

    // A selection makes the landline-overlaid builder count run; wait out the
    // debounce for the settled "Continue (50)".
    await userEvent.click(screen.getByText('mock-add-filter'))
    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: /Continue \(50\)/ },
        { timeout: 3000 },
      ),
    )

    // Name step -> Create list -> POST /voter-file/filter -> placeholder.
    await userEvent.type(
      screen.getByLabelText('mock list name'),
      'My landline list',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }))
    expect(await screen.findByText('More coming soon')).toBeInTheDocument()
  })

  it('surfaces an inline create error without advancing', async () => {
    mockSavedLists()
    mockBuilderCount(50)
    mockCreateListError()
    await gotoAudience()
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Create a new list'))
    await userEvent.click(screen.getByText('mock-add-filter'))
    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: /Continue \(50\)/ },
        { timeout: 3000 },
      ),
    )
    await userEvent.type(
      screen.getByLabelText('mock list name'),
      'My landline list',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }))

    expect(
      await screen.findByText(/We couldn't create this list/),
    ).toBeInTheDocument()
    // Did NOT advance — still on the name step.
    expect(screen.getByLabelText('mock list name')).toBeInTheDocument()
    expect(screen.queryByText('More coming soon')).not.toBeInTheDocument()

    // Back to filters must not carry the stale create error (which belongs to
    // the name step and whose retry button lives there).
    await userEvent.click(screen.getByLabelText('Back'))
    expect(screen.getByText('Build a voter list')).toBeInTheDocument()
    expect(
      screen.queryByText(/We couldn't create this list/),
    ).not.toBeInTheDocument()

    // …and the cleared error must not re-flash when re-entering the name step.
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue \(50\)/ }),
    )
    expect(screen.getByLabelText('mock list name')).toBeInTheDocument()
    expect(
      screen.queryByText(/We couldn't create this list/),
    ).not.toBeInTheDocument()
  })

  it('clears the builder and returns to the picker on Back from filters', async () => {
    mockSavedLists()
    await gotoAudience()
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Create a new list'))
    expect(screen.getByText('Build a voter list')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Back'))
    // resetBuilder returns to the picker (mode -> picker); re-opening shows a
    // fresh builder with no carried-over selection.
    expect(await screen.findByText('Choose a voter list')).toBeInTheDocument()
    expect(screen.queryByText('Build a voter list')).not.toBeInTheDocument()
  })

  it('steps Back from the name step to filters, keeping the builder', async () => {
    mockSavedLists()
    mockBuilderCount(50)
    await gotoAudience()
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Create a new list'))
    await userEvent.click(screen.getByText('mock-add-filter'))
    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: /Continue \(50\)/ },
        { timeout: 3000 },
      ),
    )
    // On the name step; Back returns to filters (not the picker), and the
    // built selection persists (count still shows).
    expect(screen.getByLabelText('mock list name')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Back'))
    expect(screen.getByText('Build a voter list')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: /Continue \(50\)/ }),
    ).toBeInTheDocument()
  })
})
