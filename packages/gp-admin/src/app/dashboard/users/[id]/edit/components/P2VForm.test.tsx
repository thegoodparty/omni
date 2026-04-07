import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { P2VForm } from './P2VForm'
import { P2VStatus, P2VSource, type PathToVictory } from '@goodparty_org/sdk'

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

vi.mock('next-navigation-guard', () => ({
  useNavigationGuard: vi.fn(),
}))

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

vi.mock('@/app/dashboard/p2v/district-actions', () => ({
  fetchDistrictTypes: vi.fn().mockResolvedValue([]),
  fetchDistrictNames: vi.fn().mockResolvedValue([]),
  updateDistrict: vi.fn().mockResolvedValue(undefined),
}))

const mockP2V: PathToVictory = {
  id: 771,
  createdAt: '2024-05-10T02:01:15.810Z',
  updatedAt: '2025-08-13T20:43:03.191Z',
  campaignId: 1,
  data: {
    p2vStatus: P2VStatus.complete,
    electionType: 'City',
    electionLocation: 'HENDERSONVILLE CITY',
    source: P2VSource.ElectionApi,
    winNumber: 3142,
    voterContactGoal: 15710,
    totalRegisteredVoters: 53278,
    projectedTurnout: 6282,
    averageTurnout: 16291,
    republicans: 6991,
    democrats: 30017,
    indies: 16270,
    men: 23793,
    women: 25651,
    white: 10138,
    asian: 13145,
    africanAmerican: 318,
    hispanic: 18755,
    viability: {
      level: 'city',
      score: 2.25,
      seats: 1,
      candidates: 0,
      isPartisan: false,
      isIncumbent: false,
      isUncontested: false,
      candidatesPerSeat: 0,
      probOfWin: 0,
    },
  },
}

const defaultProps = {
  initialData: mockP2V,
  onSave: vi.fn(),
  onCancel: vi.fn(),
}

function renderForm(props = {}) {
  const result = render(
    <Theme>
      <P2VForm {...defaultProps} {...props} />
    </Theme>
  )
  const getInput = (name: string) =>
    result.container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
  return { ...result, getInput }
}

describe('P2VForm', () => {
  it('renders form sections', () => {
    renderForm()

    expect(screen.getByText('P2V Status')).toBeInTheDocument()
    expect(screen.getByText('Target Numbers')).toBeInTheDocument()
    expect(
      screen.getByText('Demographics - Party Affiliation')
    ).toBeInTheDocument()
    expect(screen.getByText('Demographics - Gender')).toBeInTheDocument()
    expect(
      screen.getByText('Demographics - Race/Ethnicity')
    ).toBeInTheDocument()
    expect(screen.getByText('Viability Analysis')).toBeInTheDocument()
  })

  it('renders DistrictPicker when district prop is provided', () => {
    renderForm({
      district: {
        state: 'CA',
        electionYear: 2026,
        campaignId: 1,
        userId: 595,
      },
    })

    expect(screen.getByText('District Picker')).toBeInTheDocument()
    expect(screen.getByText('District Type')).toBeInTheDocument()
    expect(screen.getByText('District Name')).toBeInTheDocument()
  })

  it('does not render DistrictPicker when district prop is omitted', () => {
    renderForm()

    expect(screen.queryByText('District Picker')).not.toBeInTheDocument()
    expect(screen.queryByText('District Type')).not.toBeInTheDocument()
    expect(screen.queryByText('District Name')).not.toBeInTheDocument()
  })

  it('renders disabled election type and location fields', () => {
    renderForm()

    const inputs = screen.getAllByPlaceholderText('Set via District Picker')
    expect(inputs).toHaveLength(2)
    inputs.forEach((input) => expect(input).toBeDisabled())
  })

  it('renders with null initialData', () => {
    renderForm({ initialData: null })

    expect(screen.getByText('P2V Status')).toBeInTheDocument()
    expect(screen.getByText('Target Numbers')).toBeInTheDocument()
  })

  describe('auto-calculation from projectedTurnout', () => {
    it('does not overwrite existing winNumber and voterContactGoal on initial render', () => {
      const { getInput } = renderForm()

      expect(getInput('winNumber').value).toBe('3142')
      expect(getInput('voterContactGoal').value).toBe('15710')
    })

    it('recalculates winNumber and voterContactGoal when projectedTurnout changes', async () => {
      const user = userEvent.setup()
      const { getInput } = renderForm()

      await user.clear(getInput('projectedTurnout'))
      await user.type(getInput('projectedTurnout'), '1000')

      expect(getInput('winNumber').value).toBe('501') // floor(1000 * 0.5) + 1
      expect(getInput('voterContactGoal').value).toBe('5000') // floor(1000 * 5)
    })

    it('recalculates when projectedTurnout is changed back to the original value', async () => {
      const user = userEvent.setup()
      const { getInput } = renderForm()

      await user.clear(getInput('projectedTurnout'))
      await user.type(getInput('projectedTurnout'), '1000')

      await user.clear(getInput('projectedTurnout'))
      await user.type(getInput('projectedTurnout'), '6282')

      expect(getInput('winNumber').value).toBe('3142') // floor(6282 * 0.5) + 1
      expect(getInput('voterContactGoal').value).toBe('31410') // floor(6282 * 5)
    })

    it('clears winNumber and voterContactGoal when projectedTurnout is cleared', async () => {
      const user = userEvent.setup()
      const { getInput } = renderForm()

      await user.clear(getInput('projectedTurnout'))

      expect(getInput('winNumber').value).toBe('')
      expect(getInput('voterContactGoal').value).toBe('')
    })

    it('winNumber and voterContactGoal start empty when initialData is null', () => {
      const { getInput } = renderForm({ initialData: null })

      expect(getInput('winNumber').value).toBe('')
      expect(getInput('voterContactGoal').value).toBe('')
    })
  })
})
