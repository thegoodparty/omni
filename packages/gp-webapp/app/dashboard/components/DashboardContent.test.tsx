import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import DashboardContent from './DashboardContent'

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

const props = {
  pathname: '/dashboard',
  tcrCompliance: null,
  sunsetEligible: false,
}

describe('DashboardContent', () => {
  it('renders the campaign manager home', () => {
    render(<DashboardContent {...props} />)

    expect(screen.getByTestId('campaign-manager-home')).toBeInTheDocument()
  })
})
