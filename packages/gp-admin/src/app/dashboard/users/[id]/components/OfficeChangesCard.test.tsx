import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OfficeChangesCard } from './OfficeChangesCard'

vi.mock('@/components/ProtectedContent', () => ({
  ProtectedContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

const mockShowToast = vi.fn()
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

const mockResetOfficeChanges = vi.fn()
vi.mock('@/app/dashboard/organizations/actions', () => ({
  resetOfficeChanges: (...args: unknown[]) => mockResetOfficeChanges(...args),
}))

const renderCard = (officeChangeCount: number) =>
  render(
    <OfficeChangesCard
      organizationSlug="campaign-7"
      userId={42}
      officeChangeCount={officeChangeCount}
      officeChangeLimit={4}
    />
  )

describe('OfficeChangesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the count and flags a used-up limit', () => {
    renderCard(4)

    expect(screen.getByText('4 of 4')).toBeInTheDocument()
    expect(screen.getByText(/Limit reached/)).toBeInTheDocument()
  })

  it('disables Reset when nothing has been used', () => {
    renderCard(0)

    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
    expect(screen.queryByText(/Limit reached/)).not.toBeInTheDocument()
  })

  it('resets the count and refreshes the page', async () => {
    mockResetOfficeChanges.mockResolvedValue({ error: null })
    renderCard(4)

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() =>
      expect(mockResetOfficeChanges).toHaveBeenCalledWith('campaign-7', 42)
    )
    expect(mockShowToast).toHaveBeenCalledWith('Office changes reset')
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('shows the error from a failed reset', async () => {
    mockResetOfficeChanges.mockResolvedValue({ error: 'Nope' })
    renderCard(4)

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Nope'))
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
