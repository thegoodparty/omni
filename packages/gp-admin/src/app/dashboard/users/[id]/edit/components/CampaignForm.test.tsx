import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { CampaignForm } from './CampaignForm'
import type { Campaign } from '@goodparty_org/sdk'
import {
  CampaignLaunchStatus,
  OnboardingStep,
  BallotReadyPositionLevel,
  ElectionLevel,
  CampaignTier,
} from '@goodparty_org/sdk'
import {
  combinedCampaignSchema,
  type CombinedCampaignFormData,
} from '../schema'
import { UNSAVED_CHANGES_MESSAGE } from '../constants'
import { useNavigationGuard } from 'next-navigation-guard'

vi.mock('next-navigation-guard', () => ({
  useNavigationGuard: vi.fn(),
}))

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

const mockCampaign: Campaign = {
  id: 1,
  createdAt: new Date('2023-04-02T05:51:59.450Z'),
  updatedAt: new Date('2026-01-29T03:50:12.433Z'),
  slug: 'test-campaign',
  userId: 595,
  isActive: true,
  isVerified: false,
  isPro: true,
  isDemo: false,
  didWin: true,
  dateVerified: null,
  tier: CampaignTier.WIN,
  canDownloadFederal: false,
  completedTaskIds: [],
  hasFreeTextsOffer: false,
  aiContent: {},
  data: {
    name: 'Test Campaign',
    launchStatus: CampaignLaunchStatus.launched,
    currentStep: OnboardingStep.complete,
    adminUserEmail: 'admin@example.com',
  },
  details: {
    state: 'CA',
    city: 'Los Angeles',
    county: 'Los Angeles',
    zip: '90001',
    district: '5',
    office: 'Mayor',
    otherOffice: '',
    ballotLevel: BallotReadyPositionLevel.CITY,
    level: ElectionLevel.city,
    officeTermLength: '4 years',
    electionDate: '2026-11-03',
    primaryElectionDate: '2026-06-01',
    partisanType: 'nonpartisan',
    filingPeriodsStart: '2026-01-01',
    filingPeriodsEnd: '2026-03-01',
    party: 'Independent',
    otherParty: '',
    occupation: 'Engineer',
    funFact: 'Loves hiking',
    pastExperience: 'City council',
    website: 'https://example.com',
    pledged: true,
  },
}

describe('CampaignForm', () => {
  let onSave: ReturnType<
    typeof vi.fn<(data: CombinedCampaignFormData) => void | Promise<void>>
  >
  let onCancel: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    onSave = vi.fn<(data: CombinedCampaignFormData) => void | Promise<void>>()
    onCancel = vi.fn<() => void>()
  })

  function renderForm(
    overrides?: Partial<Campaign>,
    props?: { isSaving?: boolean }
  ) {
    const campaign = overrides
      ? { ...mockCampaign, ...overrides }
      : mockCampaign
    return render(
      <Theme>
        <CampaignForm
          initialData={campaign}
          onSave={onSave}
          onCancel={onCancel}
          {...props}
        />
      </Theme>
    )
  }

  describe('rendering', () => {
    it('renders all form sections', () => {
      renderForm()

      expect(screen.getByText('Campaign Status')).toBeInTheDocument()
      expect(
        screen.getByText('Election Results (Campaign Tier)')
      ).toBeInTheDocument()
      expect(screen.getByText('Campaign Data')).toBeInTheDocument()
      expect(screen.getByText('Location')).toBeInTheDocument()
      // "Office" appears as section heading and field label
      expect(
        screen.getByRole('heading', { name: 'Office' })
      ).toBeInTheDocument()
      expect(screen.getByText('Election')).toBeInTheDocument()
      expect(screen.getByText('Filing Period')).toBeInTheDocument()
      // "Party" appears as section heading and field label
      expect(screen.getByRole('heading', { name: 'Party' })).toBeInTheDocument()
      expect(screen.getByText('Background')).toBeInTheDocument()
    })

    it('renders status flag toggles', () => {
      renderForm()

      expect(screen.getByLabelText('Active')).toBeInTheDocument()
      expect(screen.getByLabelText('Verified')).toBeInTheDocument()
      expect(screen.getByLabelText('Pro')).toBeInTheDocument()
      expect(screen.getByLabelText('Demo')).toBeInTheDocument()
      expect(screen.getByLabelText('Won Election')).toBeInTheDocument()
      expect(screen.getByLabelText('Can Download Federal')).toBeInTheDocument()
    })

    it('renders location fields with initial values', () => {
      renderForm()

      expect(screen.getByDisplayValue('CA')).toBeInTheDocument()
      // Los Angeles appears for both city and county
      expect(screen.getAllByDisplayValue('Los Angeles')).toHaveLength(2)
      expect(screen.getByDisplayValue('90001')).toBeInTheDocument()
    })

    it('renders campaign name and admin email fields', () => {
      renderForm()

      expect(screen.getByDisplayValue('Test Campaign')).toBeInTheDocument()
      expect(screen.getByDisplayValue('admin@example.com')).toBeInTheDocument()
    })

    it('renders background text areas with initial values', () => {
      renderForm()

      const funFact = screen.getByPlaceholderText('Fun fact...')
      expect(funFact).toHaveValue('Loves hiking')

      const pastExperience = screen.getByPlaceholderText('Past experience...')
      expect(pastExperience).toHaveValue('City council')
    })

    it('renders Save Changes and Cancel buttons', () => {
      renderForm()

      expect(
        screen.getByRole('button', { name: /save changes/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /cancel/i })
      ).toBeInTheDocument()
    })

    it('renders Save button disabled when form is pristine', () => {
      renderForm()

      expect(
        screen.getByRole('button', { name: /save changes/i })
      ).toBeDisabled()
    })
  })

  describe('interactions', () => {
    it('calls onCancel when Cancel is clicked', async () => {
      renderForm()
      const user = userEvent.setup()

      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(onCancel).toHaveBeenCalledOnce()
    })

    it('enables Save button after editing a field', async () => {
      renderForm()
      const user = userEvent.setup()

      const nameInput = screen.getByDisplayValue('Test Campaign')
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Campaign')

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })
    })

    it('calls onSave with form data when Save is clicked', async () => {
      renderForm()
      const user = userEvent.setup()

      const nameInput = screen.getByDisplayValue('Test Campaign')
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Campaign')

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })

      await user.click(screen.getByRole('button', { name: /save changes/i }))

      expect(onSave).toHaveBeenCalledOnce()
      const savedData = onSave.mock.calls[0][0]
      expect(savedData.data?.name).toBe('Updated Campaign')
    })

    it('resets dirty state after successful save', async () => {
      onSave.mockResolvedValue(undefined)
      renderForm()
      const user = userEvent.setup()

      const nameInput = screen.getByDisplayValue('Test Campaign')
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated')

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })

      await user.click(screen.getByRole('button', { name: /save changes/i }))

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeDisabled()
      })
    })

    it('keeps form dirty when save fails', async () => {
      onSave.mockRejectedValue(new Error('Save failed'))
      renderForm()
      const user = userEvent.setup()

      const nameInput = screen.getByDisplayValue('Test Campaign')
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated')

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })

      await user.click(screen.getByRole('button', { name: /save changes/i }))

      // After failed save, button should remain enabled (form still dirty)
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })
    })

    it('toggles a status flag switch and makes form dirty', async () => {
      renderForm()
      const user = userEvent.setup()

      const activeSwitch = screen.getByRole('switch', { name: 'Active' })
      await user.click(activeSwitch)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })
    })

    it('toggles Pledged switch and makes form dirty', async () => {
      renderForm()
      const user = userEvent.setup()

      const switches = screen.getAllByRole('switch')
      const pledgedSwitch = switches[switches.length - 1]
      await user.click(pledgedSwitch)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })
    })

    it('changes tier via Select dropdown', async () => {
      renderForm()
      const user = userEvent.setup()

      await user.click(screen.getByRole('combobox', { name: 'Tier' }))
      const option = await screen.findByRole('option', { name: 'LOSE' })
      await user.click(option)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })
    })

    it('sets tier to null when selecting None', async () => {
      renderForm()
      const user = userEvent.setup()

      await user.click(screen.getByRole('combobox', { name: 'Tier' }))
      const noneOption = await screen.findByRole('option', { name: 'None' })
      await user.click(noneOption)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })
    })

    it('changes launch status via Select dropdown', async () => {
      renderForm()
      const user = userEvent.setup()

      await user.click(screen.getByRole('combobox', { name: 'Launch Status' }))
      const noneOption = await screen.findByRole('option', { name: 'None' })
      await user.click(noneOption)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })
    })

    it('changes ballot level via Select dropdown', async () => {
      renderForm()
      const user = userEvent.setup()

      await user.click(screen.getByRole('combobox', { name: 'Ballot Level' }))
      const option = await screen.findByRole('option', { name: 'FEDERAL' })
      await user.click(option)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })
    })

    it('changes election level via Select dropdown', async () => {
      renderForm()
      const user = userEvent.setup()

      await user.click(screen.getByRole('combobox', { name: 'Election Level' }))
      const option = await screen.findByRole('option', { name: 'Federal' })
      await user.click(option)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })
    })

    it('selects a launch status value via Select dropdown', async () => {
      renderForm({
        data: { ...mockCampaign.data, launchStatus: undefined },
      })
      const user = userEvent.setup()

      await user.click(screen.getByRole('combobox', { name: 'Launch Status' }))
      const option = await screen.findByRole('option', { name: 'Launched' })
      await user.click(option)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })
    })

    it('sets ballot level to None via Select dropdown', async () => {
      renderForm()
      const user = userEvent.setup()

      await user.click(screen.getByRole('combobox', { name: 'Ballot Level' }))
      const option = await screen.findByRole('option', { name: 'None' })
      await user.click(option)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })
    })

    it('sets election level to None via Select dropdown', async () => {
      renderForm()
      const user = userEvent.setup()

      await user.click(screen.getByRole('combobox', { name: 'Election Level' }))
      const option = await screen.findByRole('option', { name: 'None' })
      await user.click(option)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })
    })
  })

  describe('navigation guard', () => {
    it('passes confirm callback that calls window.confirm', () => {
      renderForm()

      const mockNavGuard = vi.mocked(useNavigationGuard)
      const lastCall =
        mockNavGuard.mock.calls[mockNavGuard.mock.calls.length - 1]
      const options = lastCall[0]

      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const result = options.confirm!({ to: '/test', type: 'push' })

      expect(result).toBe(true)
      expect(window.confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE)

      vi.mocked(window.confirm).mockRestore()
    })
  })

  describe('validation', () => {
    it('shows error for invalid admin email', async () => {
      renderForm()
      const user = userEvent.setup()

      const emailInput = screen.getByDisplayValue('admin@example.com')
      await user.clear(emailInput)
      await user.type(emailInput, 'not-an-email')

      await waitFor(() => {
        expect(screen.getByText('Invalid email address')).toBeInTheDocument()
      })
    })

    it('shows error for invalid website URL', async () => {
      renderForm()
      const user = userEvent.setup()

      const websiteInput = screen.getByDisplayValue('https://example.com')
      await user.clear(websiteInput)
      await user.type(websiteInput, 'not-a-url')

      await waitFor(() => {
        expect(screen.getByText('Invalid URL')).toBeInTheDocument()
      })
    })

    it('does not call onSave when safeParse fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      renderForm()
      const user = userEvent.setup()

      const nameInput = screen.getByDisplayValue('Test Campaign')
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated')

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save changes/i })
        ).toBeEnabled()
      })

      const failedResult = combinedCampaignSchema.safeParse(null)
      vi.spyOn(combinedCampaignSchema, 'safeParse').mockReturnValueOnce(
        failedResult
      )

      await user.click(screen.getByRole('button', { name: /save changes/i }))

      expect(consoleSpy).toHaveBeenCalled()
      expect(onSave).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
      vi.mocked(combinedCampaignSchema.safeParse).mockRestore()
    })
  })

  describe('defaults for nullable fields', () => {
    it('handles null data and details gracefully', () => {
      renderForm({ data: undefined, details: undefined } as Partial<Campaign>)

      expect(screen.getByText('Campaign Status')).toBeInTheDocument()
      expect(screen.getByText('Location')).toBeInTheDocument()
    })

    it('defaults nullable booleans to false when null', () => {
      renderForm({
        isVerified: null,
        isPro: null,
        didWin: null,
      })

      expect(screen.getByText('Campaign Status')).toBeInTheDocument()
    })

    it('renders with isSaving prop to disable form actions', () => {
      renderForm(undefined, { isSaving: true })

      expect(
        screen.getByRole('button', { name: /save changes/i })
      ).toBeDisabled()
      expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
    })
  })
})
