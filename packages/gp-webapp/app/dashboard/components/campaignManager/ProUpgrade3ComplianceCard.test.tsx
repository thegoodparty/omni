import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import type { Campaign } from 'helpers/types'
import { useProUpgrade3Flag } from '@shared/experiments/proUpgrade3Flag'
import ProUpgrade3ComplianceCard from './ProUpgrade3ComplianceCard'

vi.mock('@shared/experiments/proUpgrade3Flag', () => ({
  useProUpgrade3Flag: vi.fn(),
}))

// The surface itself (TCR query + status states) is covered by
// ProUpgrade3Compliance's own tests; here we only verify the dashboard gate.
vi.mock(
  'app/dashboard/profile/texting-compliance-agentic/components/ProUpgrade3Compliance',
  () => ({
    default: () => <div>compliance-surface</div>,
  }),
)

const mockUseProUpgrade3Flag = vi.mocked(useProUpgrade3Flag)

const renderCard = (isPro: boolean | null) =>
  render(
    <CampaignContext.Provider value={[{ isPro } as Campaign]}>
      <ProUpgrade3ComplianceCard />
    </CampaignContext.Provider>,
  )

describe('ProUpgrade3ComplianceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the compliance surface for a Pro candidate in the cohort', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: true, enabled: true })
    renderCard(true)

    expect(screen.getByText('compliance-surface')).toBeInTheDocument()
  })

  it('renders nothing for a non-Pro candidate', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: true, enabled: true })
    const { container } = renderCard(false)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the flag is off', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: true, enabled: false })
    const { container } = renderCard(true)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing until the flag is ready', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: false, enabled: false })
    const { container } = renderCard(true)

    expect(container).toBeEmptyDOMElement()
  })
})
