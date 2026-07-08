import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import DashboardContent from './DashboardContent'

vi.mock('@shared/experiments/campaignStoryFlag', () => ({
  useCampaignStoryFlag: vi.fn(),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Renee' }],
}))
vi.mock('../shared/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('../shared/WebsiteSunsetModalController', () => ({
  WebsiteSunsetModalController: () => null,
}))
vi.mock('../campaign-manager/CampaignManagerHome', () => ({
  default: () => <div data-testid="campaign-manager-home" />,
}))
vi.mock('./campaignManager/CampaignManager', () => ({
  default: () => <div data-testid="legacy-campaign-manager" />,
}))

const mockFlag = vi.mocked(useCampaignStoryFlag)
const setFlag = (ready: boolean, enabled: boolean): void => {
  mockFlag.mockReturnValue({ ready, enabled })
}

const props = {
  pathname: '/dashboard',
  tcrCompliance: null,
  sunsetEligible: false,
}

describe('DashboardContent', () => {
  beforeEach(() => {
    setFlag(true, false)
  })

  it('renders the campaign manager home for the campaign-story cohort', () => {
    setFlag(true, true)
    render(<DashboardContent {...props} />)

    expect(screen.getByTestId('campaign-manager-home')).toBeInTheDocument()
    expect(
      screen.queryByTestId('legacy-campaign-manager'),
    ).not.toBeInTheDocument()
  })

  it('renders the legacy dashboard home when the flag is off', () => {
    setFlag(true, false)
    render(<DashboardContent {...props} />)

    expect(screen.getByTestId('legacy-campaign-manager')).toBeInTheDocument()
    expect(
      screen.queryByTestId('campaign-manager-home'),
    ).not.toBeInTheDocument()
  })
})
