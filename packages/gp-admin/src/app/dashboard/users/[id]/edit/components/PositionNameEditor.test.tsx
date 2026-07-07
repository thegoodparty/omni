import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/lib/test-utils'
import { PositionNameEditor } from './PositionNameEditor'
import { updateOrganizationPositionName } from '@/app/dashboard/organizations/actions'

vi.mock('@/app/dashboard/organizations/actions', () => ({
  updateOrganizationPositionName: vi.fn(),
}))

const mockUpdate = vi.mocked(updateOrganizationPositionName)

const defaultProps = {
  organizationSlug: 'campaign-1',
  campaignId: 1,
  userId: 595,
  initialCustomPositionName: 'City Council',
  structuredPositionName: null,
}

describe('PositionNameEditor', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue(undefined)
  })

  it('renders the current custom position name', () => {
    renderWithProviders(<PositionNameEditor {...defaultProps} />)

    expect(screen.getByRole('textbox')).toHaveValue('City Council')
    expect(screen.getByRole('button', { name: 'Save Position' })).toBeDisabled()
  })

  it('shows the structured position as the fallback context', () => {
    renderWithProviders(
      <PositionNameEditor
        {...defaultProps}
        initialCustomPositionName={null}
        structuredPositionName="City Council - District 1"
      />
    )

    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'City Council - District 1'
    )
    expect(
      screen.getByText(/Overrides the structured position/)
    ).toBeInTheDocument()
  })

  it('saves an edited position name', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PositionNameEditor {...defaultProps} />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '  (Port St. Lucie) City Council - District 1  ')
    await user.click(screen.getByRole('button', { name: 'Save Position' }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        'campaign-1',
        '(Port St. Lucie) City Council - District 1',
        1,
        595
      )
    )
    expect(await screen.findByText('Position updated')).toBeInTheDocument()
  })

  it('saves null when the name is cleared, falling back to the position', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <PositionNameEditor
        {...defaultProps}
        structuredPositionName="City Council - District 1"
      />
    )

    await user.clear(screen.getByRole('textbox'))
    await user.click(screen.getByRole('button', { name: 'Save Position' }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('campaign-1', null, 1, 595)
    )
  })

  it('shows a failure toast and keeps the edit when the save fails', async () => {
    mockUpdate.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    renderWithProviders(<PositionNameEditor {...defaultProps} />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Mayor')
    await user.click(screen.getByRole('button', { name: 'Save Position' }))

    expect(
      await screen.findByText('Failed to update position')
    ).toBeInTheDocument()
    expect(input).toHaveValue('Mayor')
    expect(screen.getByRole('button', { name: 'Save Position' })).toBeEnabled()
  })
})
