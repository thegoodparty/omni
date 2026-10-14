import { describe, it, expect, vi, beforeEach } from 'vitest'
import { type ReactNode } from 'react'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { Campaign } from 'helpers/types'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import Page from './page'

const { mockFetchUserCampaign } = vi.hoisted(() => ({
  mockFetchUserCampaign: vi.fn<() => Promise<Campaign | null>>(),
}))

vi.mock('app/dashboard/shared/candidateAccess', () => ({
  default: vi.fn(() => Promise.resolve()),
}))

vi.mock('app/onboarding/shared/getCampaign', () => ({
  fetchUserCampaign: () => mockFetchUserCampaign(),
}))

vi.mock('helpers/metadataHelper', () => ({ default: () => ({}) }))

vi.mock('app/shared/experiments/FeatureFlagGuard', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./components/CampaignVerificationFlow', () => ({
  default: () => <div data-testid="verification-flow" />,
}))

const closedCampaign = {
  id: 1,
  smsCompliance: 'closed',
  smsCutoffDate: '2026-10-15',
  generalElectionDate: '2026-11-03',
} as Campaign

beforeEach(() => {
  vi.clearAllMocks()
})

describe('dashboard/campaign-verification page', () => {
  it('shows the verification flow while texting is open', async () => {
    mockFetchUserCampaign.mockResolvedValue({
      id: 1,
      smsCompliance: 'open',
    } as Campaign)

    render(await Page())

    expect(screen.getByTestId('verification-flow')).toBeInTheDocument()
  })

  it('shows the cutoff info screen instead of the form once texting has closed', async () => {
    mockFetchUserCampaign.mockResolvedValue(closedCampaign)

    // The server decides; the notice reads the same campaign client-side.
    render(
      <CampaignContext.Provider value={[closedCampaign]}>
        {await Page()}
      </CampaignContext.Provider>,
    )

    expect(screen.queryByTestId('verification-flow')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: "Texting isn't available for this race",
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Texting needs campaign verification, which can't finish before your general election on Nov 3.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('How else do you want to reach voters?'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to dashboard' }),
    ).toBeInTheDocument()
  })
})
