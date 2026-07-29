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
// settled-zero case can be asserted deterministically instead of racing the
// real 600ms debounce through userEvent + MSW.
// 86ajrth65 (product feedback) reversed ENG-10781's in-flight/debouncing
// stance: the CTA no longer stays clickable while loading/stale — it now
// shows the styleguide Button's loading state (spinner, data-loading, no
// number) and is disabled until the count settles. The two tests below were
// rewritten from "does not disable while loading/stale" to assert that
// reversal.
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

  it('disables the CTA with the loading spinner while a zero-bound count is still loading (86ajrth65)', async () => {
    // 86ajrth65 reversed the "enabled while loading/stale" stance this
    // suite originally pinned: the CTA now shows the styleguide Button's
    // loading state (spinner, data-loading="true") and is disabled for as
    // long as the count is unsettled, regardless of the zero-match value
    // underneath it.
    mockedUseListWizardCount.mockReturnValue(
      countResult({ count: undefined, isLoading: true }),
    )
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachConditionsStepWithSelection(user)

    // buildLabel omits the count while loading, so the accessible name has
    // no number.
    const cta = screen.getByRole('button', { name: 'Build your list' })
    expect(cta).toHaveAttribute('data-loading', 'true')
    expect(cta).toBeDisabled()
  })

  it('disables the CTA with the loading spinner on a stale zero left over from the previous selection (86ajrth65)', async () => {
    // isStale true + count 0: the 0 belongs to the payload BEFORE this
    // selection change, not the current one. Under the 86ajrth65 loading
    // reversal, isStale alone already disables the CTA (via the loading
    // state) before the zero-match gate underneath it even matters.
    mockedUseListWizardCount.mockReturnValue(
      countResult({ count: 0, isStale: true }),
    )
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachConditionsStepWithSelection(user)

    // buildLabel hides the stale number entirely (no "(0)").
    const cta = screen.getByRole('button', { name: 'Build your list' })
    expect(cta).toHaveTextContent(/^Build your list$/)
    expect(cta).toHaveAttribute('data-loading', 'true')
    expect(cta).toBeDisabled()
  })

  it('re-enables the CTA with the count once a loading count settles (86ajrth65 core AC)', async () => {
    mockedUseListWizardCount.mockReturnValue(
      countResult({ count: undefined, isLoading: true }),
    )
    const user = userEvent.setup()
    const { rerender } = render(
      <CreateListWizard open onOpenChange={vi.fn()} />,
    )

    await reachConditionsStepWithSelection(user)

    const loadingCta = screen.getByRole('button', { name: 'Build your list' })
    expect(loadingCta).toHaveAttribute('data-loading', 'true')
    expect(loadingCta).toBeDisabled()

    // The count settles for the same selection — the CTA must re-enable
    // and show the number (open/onOpenChange are unchanged, so this
    // doesn't retrigger the wizard's open-session reset effect).
    mockedUseListWizardCount.mockReturnValue(countResult({ count: 42 }))
    rerender(<CreateListWizard open onOpenChange={vi.fn()} />)

    const settledCta = screen.getByRole('button', {
      name: 'Build your list (42)',
    })
    expect(settledCta).toHaveAttribute('data-loading', 'false')
    expect(settledCta).toBeEnabled()
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
