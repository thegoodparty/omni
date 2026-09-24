import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import {
  INTERSTITIAL_COPY,
  PITCH_PANEL_COPY,
  PRO_COPY,
} from 'app/dashboard/outreach/v2/gate/gateCopy'
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

  it('renders the join title, the texting value card and the verification card', () => {
    render(<InterstitialStep />)

    expect(screen.getByText(INTERSTITIAL_COPY.title)).toBeInTheDocument()
    expect(screen.getByText(PRO_COPY.sms.headline)).toBeInTheDocument()
    PRO_COPY.sms.bullets.forEach((bullet) => {
      expect(screen.getByText(bullet)).toBeInTheDocument()
    })
    expect(screen.getByText(PITCH_PANEL_COPY.verifyTitle)).toBeInTheDocument()
  })

  it('renders the robocall value card and no verification card', () => {
    setChannel('robocall')
    render(<InterstitialStep />)

    expect(screen.getByText(INTERSTITIAL_COPY.title)).toBeInTheDocument()
    expect(screen.getByText(PRO_COPY.robocall.headline)).toBeInTheDocument()
    expect(screen.queryByText(PITCH_PANEL_COPY.verifyTitle)).toBeNull()
  })

  it('renders the door-knocking value card', () => {
    setChannel('door')
    render(<InterstitialStep />)

    expect(screen.getByText(PRO_COPY.door.headline)).toBeInTheDocument()
  })

  it('advances to the next step when the join CTA is clicked', () => {
    render(<InterstitialStep />)

    screen.getByRole('button', { name: INTERSTITIAL_COPY.cta }).click()

    expect(goToNextStep).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })

  it('keeps the same join CTA on every channel', () => {
    setChannel('robocall')
    render(<InterstitialStep />)

    expect(
      screen.getByRole('button', { name: INTERSTITIAL_COPY.cta }),
    ).toBeInTheDocument()
  })

  it('calls exit when Maybe later is clicked', () => {
    render(<InterstitialStep />)

    screen.getByRole('button', { name: INTERSTITIAL_COPY.dismiss }).click()

    expect(exit).toHaveBeenCalledTimes(1)
    expect(goToNextStep).not.toHaveBeenCalled()
  })
})
