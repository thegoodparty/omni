import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { useSnackbar } from 'helpers/useSnackbar'
import CreateListWizard from './CreateListWizard'
import { useContactsTable } from '../ContactsTableProvider'
import {
  useListWizardCount,
  type ListWizardCountResult,
} from './useListWizardCount'

// ENG-10781: locks the conditions-step build CTA's zero-match gate directly
// to the count hook's return value — the same technique
// CreateListWizard.staleGate.test.tsx uses for the Save gate — so the
// in-flight/debouncing "don't flash disabled" requirement can be asserted
// deterministically instead of racing the real 600ms debounce through
// userEvent + MSW.
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

const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseSnackbar = vi.mocked(useSnackbar)
const mockedUseListWizardCount = vi.mocked(useListWizardCount)

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

// Reach the voter-file conditions step with one valid selection — the point
// where only the count gate governs the build CTA's disabled state.
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

// Same, but through the activity branch — a bare channel selection (no
// specific campaign/outcome needed) already satisfies isActivityStepValid,
// so the zero-match gate is the only thing left to prove here.
const reachActivityConditionsStepWithSelection = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> => {
  await user.click(
    screen.getByRole('radio', {
      name: /build a list from previous campaign activity/i,
    }),
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(screen.getByRole('radio', { name: 'Text' }))
}

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
})

const countResult = (
  overrides: Partial<ListWizardCountResult>,
): ListWizardCountResult => ({
  count: undefined,
  fenced: undefined,
  isLoading: false,
  isStale: false,
  isError: false,
  isCapError: false,
  errorMessage: undefined,
  ...overrides,
})

describe('CreateListWizard — build CTA zero-match gate (ENG-10781)', () => {
  it('disables the build CTA once a valid selection resolves to a settled zero', async () => {
    mockedUseListWizardCount.mockReturnValue(countResult({ count: 0 }))
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachConditionsStepWithSelection(user)

    const cta = screen.getByRole('button', { name: 'Build your list (0)' })
    expect(cta).toBeDisabled()

    // Programmatic activation must not advance to the name step either —
    // the guard lives in handleNext, not only on the disabled prop.
    fireEvent.click(cta)
    expect(
      screen.queryByRole('heading', { name: 'Name your list' }),
    ).not.toBeInTheDocument()
  })

  it('enables the build CTA once a valid selection resolves to a nonzero count', async () => {
    mockedUseListWizardCount.mockReturnValue(countResult({ count: 42 }))
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachConditionsStepWithSelection(user)

    expect(
      screen.getByRole('button', { name: 'Build your list (42)' }),
    ).toBeEnabled()
  })

  it('does not disable the CTA while a zero-bound count is still loading', async () => {
    mockedUseListWizardCount.mockReturnValue(
      countResult({ count: undefined, isLoading: true }),
    )
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachConditionsStepWithSelection(user)

    // buildLabel already omits the count while loading, so there is no
    // number to disable "at zero" — a valid selection alone keeps it enabled.
    expect(
      screen.getByRole('button', { name: 'Build your list' }),
    ).toBeEnabled()
  })

  it('does not disable the CTA on a stale zero left over from the previous selection', async () => {
    // isStale true + count 0: the 0 belongs to the payload BEFORE this
    // selection change, not the current one — the exact window that must
    // not disable, mirroring the staleGate suite's isStale-alone assertion
    // for the Save button.
    mockedUseListWizardCount.mockReturnValue(
      countResult({ count: 0, isStale: true }),
    )
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachConditionsStepWithSelection(user)

    // buildLabel hides the stale number entirely (no "(0)"), and the CTA
    // stays enabled.
    const cta = screen.getByRole('button', { name: 'Build your list' })
    expect(cta).toHaveTextContent(/^Build your list$/)
    expect(cta).toBeEnabled()
  })

  it('disables the build CTA for the activity branch once a valid selection resolves to a settled zero', async () => {
    mockedUseListWizardCount.mockReturnValue(countResult({ count: 0 }))
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachActivityConditionsStepWithSelection(user)

    const cta = screen.getByRole('button', { name: 'Build your list (0)' })
    expect(cta).toBeDisabled()

    // Programmatic activation must not advance to the name step either —
    // the guard lives in handleNext, not only on the disabled prop.
    fireEvent.click(cta)
    expect(
      screen.queryByRole('heading', { name: 'Name your list' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the build CTA enabled when the count query errors with a retained zero', async () => {
    // A failed refetch retains the previous cached count (possibly 0) with
    // isLoading/isStale both false — an errored count is unknown, not zero,
    // so the zero-match gate must not fire on it.
    mockedUseListWizardCount.mockReturnValue(
      countResult({ count: 0, isError: true }),
    )
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachConditionsStepWithSelection(user)

    expect(
      screen.getByRole('button', { name: /build your list/i }),
    ).toBeEnabled()
  })

  it('enables the build CTA for the activity branch once a valid selection resolves to a nonzero count', async () => {
    mockedUseListWizardCount.mockReturnValue(countResult({ count: 17 }))
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachActivityConditionsStepWithSelection(user)

    expect(
      screen.getByRole('button', { name: 'Build your list (17)' }),
    ).toBeEnabled()
  })
})
