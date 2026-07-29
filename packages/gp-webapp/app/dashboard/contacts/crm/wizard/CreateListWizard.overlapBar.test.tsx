import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { useSnackbar } from 'helpers/useSnackbar'
import CreateListWizard from './CreateListWizard'
import { useContactsTable } from '../ContactsTableProvider'
import {
  useListWizardCount,
  type ListWizardCountResult,
} from './useListWizardCount'
import {
  useListWizardOverlapCount,
  type ListWizardOverlapCountResult,
} from './useListWizardOverlapCount'

// ENG-10840: the saved-list overlap strip's render gate is a conjunction of
// three independent hooks/props (org's saved lists, the live count, and the
// overlap count) — locking all three to mocks (same technique as the
// zeroMatchGate/staleGate suites) lets each AC state be asserted
// deterministically instead of racing MSW + the two 600ms debounces.
vi.mock('../ContactsTableProvider', () => ({ useContactsTable: vi.fn() }))
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
vi.mock('./useListWizardCount', () => ({ useListWizardCount: vi.fn() }))
vi.mock('./useListWizardOverlapCount', () => ({
  useListWizardOverlapCount: vi.fn(),
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseSnackbar = vi.mocked(useSnackbar)
const mockedUseListWizardCount = vi.mocked(useListWizardCount)
const mockedUseListWizardOverlapCount = vi.mocked(useListWizardOverlapCount)

type ContextValue = ReturnType<typeof useContactsTable>

const refreshCustomSegments = vi.fn().mockResolvedValue(undefined)
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

const pillForOption = (label: string): HTMLElement =>
  screen.getByRole('button', { name: label })

const reachConditionsStepWithSelection = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> => {
  await user.click(
    screen.getByRole('radio', {
      name: /build a list using voter demographics and data/i,
    }),
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(pillForOption('Female'))
}

const countResult = (
  overrides: Partial<ListWizardCountResult> = {},
): ListWizardCountResult => ({
  // 47,240 / 200,000 rounds to 24% — the exact prototype figures from the
  // reference screenshot (wizard-overlap-bar.png).
  count: 200000,
  fenced: false,
  isLoading: false,
  isStale: false,
  isError: false,
  isCapError: false,
  errorMessage: undefined,
  ...overrides,
})

const overlapResult = (
  overrides: Partial<ListWizardOverlapCountResult> = {},
): ListWizardOverlapCountResult => ({
  count: 47240,
  fenced: false,
  isLoading: false,
  isStale: false,
  isError: false,
  ...overrides,
})

const savedList = { id: 1, name: 'A saved list' }

beforeEach(() => {
  vi.clearAllMocks()
  mockedUseSnackbar.mockReturnValue({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  })
  refreshCustomSegments.mockClear()
  selectList.mockClear()
  setContext()
  mockedUseListWizardCount.mockReturnValue(countResult())
  mockedUseListWizardOverlapCount.mockReturnValue(overlapResult())
})

describe('CreateListWizard — saved-list overlap strip (ENG-10840)', () => {
  it('renders "N (P%) voters already exist in lists you\'ve saved." once a pill is selected and the org has a saved list', async () => {
    setContext({ customSegments: [savedList] } as never)
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachConditionsStepWithSelection(user)

    expect(
      screen.getByText(
        "47,240 (24%) voters already exist in lists you've saved.",
      ),
    ).toBeInTheDocument()
  })

  it('renders no strip when the org has no saved lists', async () => {
    setContext({ customSegments: [] } as never)
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachConditionsStepWithSelection(user)

    expect(
      screen.queryByText(/already exist in lists you've saved/i),
    ).not.toBeInTheDocument()
  })

  it('renders no strip before any pill is selected', async () => {
    setContext({ customSegments: [savedList] } as never)
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await user.click(
      screen.getByRole('radio', {
        name: /build a list using voter demographics and data/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      screen.queryByText(/already exist in lists you've saved/i),
    ).not.toBeInTheDocument()
  })

  it('renders no strip when the overlap request fails, and never disables the CTA', async () => {
    setContext({ customSegments: [savedList] } as never)
    mockedUseListWizardOverlapCount.mockReturnValue(
      overlapResult({ count: undefined, isError: true }),
    )
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachConditionsStepWithSelection(user)

    expect(
      screen.queryByText(/already exist in lists you've saved/i),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Build your list (200,000)' }),
    ).toBeEnabled()
  })

  it('renders the fenced count with no percent', async () => {
    setContext({ customSegments: [savedList] } as never)
    mockedUseListWizardOverlapCount.mockReturnValue(
      overlapResult({ count: 10000, fenced: true }),
    )
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachConditionsStepWithSelection(user)

    expect(
      screen.getByText("10,000+ voters already exist in lists you've saved."),
    ).toBeInTheDocument()
  })

  it('suppresses the percent when the live (denominator) count is fenced, even if the overlap is not', async () => {
    setContext({ customSegments: [savedList] } as never)
    mockedUseListWizardCount.mockReturnValue(countResult({ fenced: true }))
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachConditionsStepWithSelection(user)

    expect(
      screen.getByText("47,240 voters already exist in lists you've saved."),
    ).toBeInTheDocument()
  })
})
