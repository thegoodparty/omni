import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { useProUpgradeFlag } from '@shared/experiments/proUpgradeFlag'
import { useProUpgrade3Flag } from '@shared/experiments/proUpgrade3Flag'
import { ComplianceModal } from './ComplianceModal'

vi.mock('@shared/experiments/proUpgradeFlag', () => ({
  useProUpgradeFlag: vi.fn(),
}))

vi.mock('@shared/experiments/proUpgrade3Flag', () => ({
  useProUpgrade3Flag: vi.fn(),
  PRO_UPGRADE_ENTRY_PATH: '/dashboard/pro-upgrade',
}))

const mockUseProUpgradeFlag = vi.mocked(useProUpgradeFlag)
const mockUseProUpgrade3Flag = vi.mocked(useProUpgrade3Flag)

describe('ComplianceModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProUpgradeFlag.mockReturnValue({ ready: true, enabled: true })
    mockUseProUpgrade3Flag.mockReturnValue({ ready: true, enabled: true })
  })

  it('shows the PIN-entry prompt for a submitted registration', () => {
    render(
      <ComplianceModal
        open
        tcrComplianceStatus="submitted"
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Submit your PIN to finish texting registration'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Action required: register for texting compliance'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Enter PIN' })).toHaveAttribute(
      'href',
      '/dashboard/profile/texting-compliance/submit-pin',
    )
  })

  it('shows the under-review prompt for a pending registration', () => {
    render(
      <ComplianceModal open tcrComplianceStatus="pending" onClose={vi.fn()} />,
    )

    expect(
      screen.getByText('Texting registration under review'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
  })

  it('shows the needs-attention prompt for a rejected registration', () => {
    render(
      <ComplianceModal open tcrComplianceStatus="rejected" onClose={vi.fn()} />,
    )

    expect(
      screen.getByText('Texting registration needs attention'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Contact Support' }),
    ).toHaveAttribute('href', 'mailto:support@goodparty.org')
  })

  it('shows the error prompt for an errored registration', () => {
    render(
      <ComplianceModal open tcrComplianceStatus="error" onClose={vi.fn()} />,
    )

    expect(screen.getByText('Registration error')).toBeInTheDocument()
  })

  it('shows the registration prompt when no compliance record exists', () => {
    render(
      <ComplianceModal open tcrComplianceStatus={null} onClose={vi.fn()} />,
    )

    expect(
      screen.getByText('Action required: register for texting compliance'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Start Registration' }),
    ).toHaveAttribute('href', '/dashboard/pro-upgrade')
  })

  it('links to the profile compliance section when proUpgrade3 is off-cohort', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: true, enabled: false })
    render(
      <ComplianceModal open tcrComplianceStatus={null} onClose={vi.fn()} />,
    )

    expect(
      screen.getByRole('link', { name: 'Start Registration' }),
    ).toHaveAttribute('href', '/dashboard/profile#texting-compliance')
  })
})
