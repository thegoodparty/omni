import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { DistrictPicker } from './DistrictPicker'
import type { DistrictTypeItem, DistrictNameItem } from '@goodparty_org/sdk'

// Radix UI polyfills
class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
globalThis.ResizeObserver =
  ResizeObserverMock as unknown as typeof ResizeObserver

Element.prototype.hasPointerCapture = vi.fn(() => false)
Element.prototype.setPointerCapture = vi.fn()
Element.prototype.releasePointerCapture = vi.fn()
HTMLElement.prototype.scrollIntoView = vi.fn()

const mockShowToast = vi.fn()

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

const mockFetchDistrictTypes = vi.fn()
const mockFetchDistrictNames = vi.fn()
const mockUpdateDistrict = vi.fn()

vi.mock('@/app/dashboard/p2v/district-actions', () => ({
  fetchDistrictTypes: (...args: unknown[]) => mockFetchDistrictTypes(...args),
  fetchDistrictNames: (...args: unknown[]) => mockFetchDistrictNames(...args),
  updateDistrict: (...args: unknown[]) => mockUpdateDistrict(...args),
}))

const mockTypes: DistrictTypeItem[] = [
  { id: '1', L2DistrictType: 'State_Senate' },
  { id: '2', L2DistrictType: 'City_Council' },
]

const mockNames: DistrictNameItem[] = [
  { id: '10', L2DistrictName: 'District 5' },
  { id: '11', L2DistrictName: 'District 12' },
]

const defaultProps = {
  state: 'CA',
  electionYear: 2026,
  campaignId: 1,
  userId: 595,
}

function renderPicker(props = {}) {
  return render(
    <Theme>
      <DistrictPicker {...defaultProps} {...props} />
    </Theme>
  )
}

describe('DistrictPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchDistrictTypes.mockResolvedValue(mockTypes)
    mockFetchDistrictNames.mockResolvedValue(mockNames)
    mockUpdateDistrict.mockResolvedValue(undefined)
  })

  it('renders district type and name dropdowns', async () => {
    renderPicker()

    expect(screen.getByText('District Type')).toBeInTheDocument()
    expect(screen.getByText('District Name')).toBeInTheDocument()
  })

  it('renders the Save District button', () => {
    renderPicker()

    expect(
      screen.getByRole('button', { name: /save district/i })
    ).toBeInTheDocument()
  })

  it('shows missing state message when state is empty', () => {
    renderPicker({ state: '' })

    expect(
      screen.getByText(/missing state — cannot load districts/i)
    ).toBeInTheDocument()
    expect(screen.queryByText('District Type')).not.toBeInTheDocument()
  })

  it('shows missing election date message when electionYear is falsy', () => {
    renderPicker({ electionYear: 0 })

    expect(
      screen.getByText(/missing election date — cannot load districts/i)
    ).toBeInTheDocument()
    expect(screen.queryByText('District Type')).not.toBeInTheDocument()
  })

  it('save button is disabled when no type/name selected', () => {
    renderPicker()

    const saveButton = screen.getByRole('button', { name: /save district/i })
    expect(saveButton).toBeDisabled()
  })

  it('calls fetchDistrictTypes on mount with state, year, and excludeInvalid', async () => {
    renderPicker()

    await waitFor(() => {
      expect(mockFetchDistrictTypes).toHaveBeenCalledWith('CA', 2026, true)
    })
  })

  it('type selection resets name selection', async () => {
    const user = userEvent.setup()
    renderPicker({ initialElectionType: 'State_Senate' })

    await waitFor(() => {
      expect(mockFetchDistrictNames).toHaveBeenCalled()
    })

    // Click the type trigger to open dropdown
    const triggers = screen.getAllByRole('combobox')
    const typeTrigger = triggers[0]
    await user.click(typeTrigger)

    // Select a different type — pick "None" to reset
    const noneOption = screen.getByRole('option', { name: 'None' })
    await user.click(noneOption)

    // Save should still be disabled since name is reset
    const saveButton = screen.getByRole('button', { name: /save district/i })
    expect(saveButton).toBeDisabled()
  })

  it('calls updateDistrict with correct args on save', async () => {
    const onDistrictSaved = vi.fn()
    const user = userEvent.setup()

    renderPicker({
      initialElectionType: 'State_Senate',
      initialElectionLocation: 'District 5',
      onDistrictSaved,
    })

    await waitFor(() => {
      expect(mockFetchDistrictTypes).toHaveBeenCalled()
    })

    const saveButton = screen.getByRole('button', { name: /save district/i })
    await user.click(saveButton)

    await waitFor(() => {
      expect(mockUpdateDistrict).toHaveBeenCalledWith(
        1,
        'State_Senate',
        'District 5',
        595
      )
    })

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('District updated')
      expect(onDistrictSaved).toHaveBeenCalled()
    })
  })

  it('shows error toast when updateDistrict fails', async () => {
    mockUpdateDistrict.mockRejectedValue(new Error('Network error'))
    const user = userEvent.setup()

    renderPicker({
      initialElectionType: 'State_Senate',
      initialElectionLocation: 'District 5',
    })

    await waitFor(() => {
      expect(mockFetchDistrictTypes).toHaveBeenCalled()
    })

    const saveButton = screen.getByRole('button', { name: /save district/i })
    await user.click(saveButton)

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Failed to update district')
    })
  })

  it('renders the exclude-invalid checkbox', () => {
    renderPicker()

    expect(
      screen.getByText(
        /show all districts \(including those without projected turnout\)/i
      )
    ).toBeInTheDocument()
  })

  it('handles fetchDistrictTypes failure gracefully', async () => {
    mockFetchDistrictTypes.mockRejectedValue(new Error('Server error'))

    renderPicker()

    await waitFor(() => {
      expect(mockFetchDistrictTypes).toHaveBeenCalled()
    })

    // Component should still render without crashing
    expect(screen.getByText('District Type')).toBeInTheDocument()
  })
})
