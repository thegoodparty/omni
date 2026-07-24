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

// ENG-10769: locks the Save gate directly to `isStale`. The full-flow debounce
// race is timing-dependent (see CreateListWizard.test.tsx's stress history), so
// this file stubs the count hook to hold the exact isStale=true/isLoading=false
// window open deterministically — a plain render, no timers. Removing `!isStale`
// from canSubmit flips the "still debouncing" case below from disabled to
// enabled and fails here, which the real-timer suite can't reliably catch.
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

const settledCount: ListWizardCountResult = {
  count: 250,
  isLoading: false,
  isStale: false,
  isError: false,
  isCapError: false,
  errorMessage: undefined,
}

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

const pillForOption = (label: string): HTMLElement =>
  screen.getByRole('button', { name: label })

// Drive the wizard to the name step (voter-file branch, one pill picked) and
// name the list — the point where only the count gate governs Save.
const reachNameStep = async (
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> => {
  await user.click(
    screen.getByRole('radio', { name: /build my list using the voter file/i }),
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(pillForOption('Female'))
  await user.click(screen.getByRole('button', { name: /build your list/i }))
  await user.type(screen.getByLabelText(/list name/i), 'Gated list')
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
  mockedUseListWizardCount.mockReturnValue(settledCount)
})

describe('CreateListWizard — Save gate on the live count (ENG-10769)', () => {
  it('enables Save once the count has settled for the current selection', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachNameStep(user)

    expect(screen.getByRole('button', { name: 'Save list' })).toBeEnabled()
  })

  it('keeps Save disabled while the count is stale, even though it is not loading', async () => {
    // The debounce window: the resolved count still reflects the PREVIOUS
    // selection (isLoading false), so saving now would persist a wrong
    // voterCount. isStale must hold Save closed on its own.
    mockedUseListWizardCount.mockReturnValue({
      ...settledCount,
      isStale: true,
    })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    await reachNameStep(user)

    expect(screen.getByRole('button', { name: 'Save list' })).toBeDisabled()
  })
})
