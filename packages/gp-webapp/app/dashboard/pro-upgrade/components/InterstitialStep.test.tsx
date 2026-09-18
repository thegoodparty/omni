import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import InterstitialStep from './InterstitialStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'

vi.mock('./ProUpgradeWizard', () => ({
  useProUpgradeWizard: vi.fn(),
}))

const mockUseProUpgradeWizard = vi.mocked(useProUpgradeWizard)
const goToNextStep = vi.fn()
const exit = vi.fn()

const setChannel = (channel: 'sms' | 'robocall' | 'door' | 'phone-bank') =>
  mockUseProUpgradeWizard.mockReturnValue({
    currentStep: 'interstitial',
    purchaseOnly: true,
    channel,
    goToStep: vi.fn(),
    goToNextStep,
    goToPreviousStep: vi.fn(),
    exit,
    complete: vi.fn(),
  })

describe('InterstitialStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setChannel('sms')
  })

  it('renders the texting copy with both step cards and the free-texts pill', () => {
    render(<InterstitialStep />)

    expect(
      screen.getByText('Your first text has been made'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "To send it, you need to upgrade to Pro and verify your campaign. We'll save it for 90 days.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Campaign verification')).toBeInTheDocument()
    expect(
      screen.getByText('Your first 5,000 texts are free'),
    ).toBeInTheDocument()
  })

  it('renders the robocall copy with a single, unnumbered step card and no pill', () => {
    setChannel('robocall')
    render(<InterstitialStep />)

    expect(
      screen.getByText('Your first robocall has been made'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "To send it, you need to upgrade to Pro. We'll save it for 90 days.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument()
    expect(screen.queryByText('Campaign verification')).not.toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Your first 5,000 texts are free'),
    ).not.toBeInTheDocument()
  })

  it('renders the door-knocking copy with the generic saved-work body', () => {
    setChannel('door')
    render(<InterstitialStep />)

    expect(
      screen.getByText('Your first door knocking list has been made'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'To send it, you need to upgrade to Pro. Your work stays saved.',
      ),
    ).toBeInTheDocument()
  })

  it('advances to the next step when the upgrade CTA is clicked', async () => {
    render(<InterstitialStep />)

    screen.getByRole('button', { name: 'Upgrade for $10' }).click()

    expect(goToNextStep).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })

  it('shows the channel-specific CTA label', () => {
    setChannel('robocall')
    render(<InterstitialStep />)

    expect(
      screen.getByRole('button', { name: 'Upgrade to send my call' }),
    ).toBeInTheDocument()
  })

  it('calls exit when Finish later is clicked', () => {
    render(<InterstitialStep />)

    screen.getByRole('button', { name: 'Finish later' }).click()

    expect(exit).toHaveBeenCalledTimes(1)
    expect(goToNextStep).not.toHaveBeenCalled()
  })
})
