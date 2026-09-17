import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import type { Campaign, TcrCompliance } from 'helpers/types'
import ProUpgrade3ComplianceCard from './ProUpgrade3ComplianceCard'

// The surface itself (TCR query + status states) is covered by
// ProUpgrade3Compliance's own tests; here we only verify the dashboard gate.
vi.mock(
  'app/dashboard/profile/texting-compliance-agentic/components/ProUpgrade3Compliance',
  () => ({
    default: () => <div>compliance-surface</div>,
  }),
)

const tcrWith = (status: string): TcrCompliance => ({ status }) as TcrCompliance

const renderCard = (
  isPro: boolean | null,
  tcrCompliance: TcrCompliance | null = null,
) =>
  render(
    <CampaignContext.Provider value={[{ isPro } as Campaign]}>
      <ProUpgrade3ComplianceCard tcrCompliance={tcrCompliance} />
    </CampaignContext.Provider>,
  )

describe('ProUpgrade3ComplianceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the compliance surface for a Pro candidate', () => {
    renderCard(true)

    expect(screen.getByText('compliance-surface')).toBeInTheDocument()
  })

  it('renders nothing for a non-Pro candidate', () => {
    const { container } = renderCard(false)

    expect(container).toBeEmptyDOMElement()
  })

  // TextingSetupBanner owns the failed-registration retry prompt on this page,
  // so rendering the surface's generic "set up" fallthrough under it would put
  // two conflicting prompts on the home.
  it('renders nothing for a retryable error record', () => {
    const { container } = renderCard(true, tcrWith('error'))

    expect(container).toBeEmptyDOMElement()
  })

  it.each(['submitted', 'pending', 'approved', 'rejected'])(
    'still renders the surface for status %s',
    (status) => {
      renderCard(true, tcrWith(status))

      expect(screen.getByText('compliance-surface')).toBeInTheDocument()
    },
  )
})
