import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { CrmContactsPage } from './CrmContactsPage'
import { useContactsTable } from './ContactsTableProvider'

vi.mock('./ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('@shared/hooks/useCampaign', () => ({ useCampaign: () => [null] }))
vi.mock('../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('app/dashboard/shared/ProUpgradeModal', () => ({
  ProUpgradeModal: () => null,
  VARIANTS: { Second_NonViable: 'second-nonviable' },
}))
vi.mock('./person/PersonOverlay', () => ({
  default: () => <div data-testid="person-overlay" />,
}))
vi.mock('./ContactTypeahead', () => ({
  ContactTypeahead: () => <div data-testid="typeahead" />,
}))
vi.mock('./wizard/CreateListWizard', () => ({
  default: ({
    open,
    onOpenChange,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div data-testid="create-list-wizard">
        <button onClick={() => onOpenChange(false)}>close wizard</button>
      </div>
    ) : null,
}))
vi.mock('./DistrictStatCard', () => ({
  default: () => <div data-testid="district-stat" />,
}))
vi.mock('./lists/ListsIndex', () => ({
  default: () => <div data-testid="lists-index" />,
}))
vi.mock('./lists/ListDetailSheet', () => ({
  default: ({
    listId,
    onClose,
  }: {
    listId: string | null
    onClose: () => void
  }) =>
    listId ? (
      <div data-testid="list-detail-sheet">
        <button data-testid="close-list-detail" onClick={onClose}>
          close
        </button>
      </div>
    ) : null,
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)

type ContextValue = ReturnType<typeof useContactsTable>

const setContext = (overrides: Partial<ContextValue> = {}) => {
  mockedUseContactsTable.mockReturnValue({
    isWinContext: true,
    isWinContextReady: true,
    canUseProFeatures: true,
    customSegments: [],
    currentlySelectedListId: null,
    selectList: vi.fn(),
    ...overrides,
  } as ContextValue)
}

beforeEach(() => {
  setContext()
})

describe('CrmContactsPage — mode-aware universe title', () => {
  it('reads "Your Voter Universe" for a Win campaign and never says constituent', () => {
    setContext({ isWinContext: true })

    render(<CrmContactsPage />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Your Voter Universe' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/constituent/i)).not.toBeInTheDocument()
  })

  it('reads "Your Constituent Universe" for the Serve/elected-office path', () => {
    setContext({ isWinContext: false })

    render(<CrmContactsPage />)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Your Constituent Universe',
      }),
    ).toBeInTheDocument()
  })

  it('renders no title until the Win/Serve context is ready (Win never flashes "constituent")', () => {
    setContext({ isWinContext: false, isWinContextReady: false })

    render(<CrmContactsPage />)

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.queryByText(/constituent/i)).not.toBeInTheDocument()
    // The button itself must be gated too, not just the copy below it — a
    // click before the mode settles could open the wizard with a
    // not-yet-resolved isWinContext (see BranchStep.tsx's own crossover fix).
    expect(
      screen.getByRole('button', { name: 'Create new list' }),
    ).toBeDisabled()
  })

  it('enables "Create new list" once the Win/Serve context is ready', () => {
    setContext({ isWinContext: true, isWinContextReady: true })

    render(<CrmContactsPage />)

    expect(
      screen.getByRole('button', { name: 'Create new list' }),
    ).toBeEnabled()
  })
})

describe('CrmContactsPage — page contents', () => {
  it('renders the typeahead and the person overlay (selection opens the record over this page)', () => {
    render(<CrmContactsPage />)

    expect(screen.getByTestId('typeahead')).toBeInTheDocument()
    expect(screen.getByTestId('person-overlay')).toBeInTheDocument()
  })

  it('renders an enabled "Create new list" button that opens the wizard for a pro user', async () => {
    const user = userEvent.setup()
    setContext({ canUseProFeatures: true })
    render(<CrmContactsPage />)

    const button = screen.getByRole('button', { name: 'Create new list' })
    expect(button).toBeEnabled()
    expect(screen.queryByTestId('create-list-wizard')).not.toBeInTheDocument()

    await user.click(button)

    expect(router.push).not.toHaveBeenCalled()
    expect(screen.getByTestId('create-list-wizard')).toBeInTheDocument()
  })

  it('never opens the wizard for a non-pro user (Pro upgrade gate reused from the legacy create flow)', async () => {
    const user = userEvent.setup()
    setContext({ canUseProFeatures: false })
    render(<CrmContactsPage />)

    await user.click(screen.getByRole('button', { name: 'Create new list' }))

    expect(screen.queryByTestId('create-list-wizard')).not.toBeInTheDocument()
  })

  it('opens the list-detail sheet from the provider list selection and closes it via selectList(null)', async () => {
    const user = userEvent.setup()
    const selectList = vi.fn()
    setContext({ currentlySelectedListId: '42', selectList })
    render(<CrmContactsPage />)

    expect(screen.getByTestId('list-detail-sheet')).toBeInTheDocument()

    await user.click(screen.getByTestId('close-list-detail'))

    expect(selectList).toHaveBeenCalledWith(null)
  })

  it('renders no list-detail sheet when no list is selected', () => {
    setContext({ currentlySelectedListId: null })
    render(<CrmContactsPage />)

    expect(screen.queryByTestId('list-detail-sheet')).not.toBeInTheDocument()
  })
})
