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

const mockedUseContactsTable = vi.mocked(useContactsTable)

type ContextValue = ReturnType<typeof useContactsTable>

const setContext = (overrides: Partial<ContextValue> = {}) => {
  mockedUseContactsTable.mockReturnValue({
    isWinContext: true,
    isWinContextReady: true,
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
  })
})

describe('CrmContactsPage — page contents', () => {
  it('renders the typeahead and the person overlay (selection opens the record over this page)', () => {
    render(<CrmContactsPage />)

    expect(screen.getByTestId('typeahead')).toBeInTheDocument()
    expect(screen.getByTestId('person-overlay')).toBeInTheDocument()
  })

  it('renders an enabled "Create new list" button that does nothing when clicked', async () => {
    const user = userEvent.setup()
    render(<CrmContactsPage />)

    const button = screen.getByRole('button', { name: 'Create new list' })
    expect(button).toBeEnabled()

    await user.click(button)

    // Placeholder until the Voter Lists table (CRM feature 4): no navigation,
    // no error.
    expect(router.push).not.toHaveBeenCalled()
    expect(button).toBeInTheDocument()
  })
})
