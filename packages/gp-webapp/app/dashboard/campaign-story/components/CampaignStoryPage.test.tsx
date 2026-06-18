import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import CampaignStoryPage from './CampaignStoryPage'

vi.mock('../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@shared/experiments/FeatureFlagGuard', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('./CampaignStoryCard', () => ({
  default: () => <div data-testid="story-card" />,
}))

const complete = { why: 'w', background: 'b', issues: 'i' }
const incomplete = { why: 'w', background: '', issues: '' }

const footerLink = () =>
  screen.queryByRole('link', { name: 'Generate my Campaign Plan' })

describe('CampaignStoryPage', () => {
  it('hides the generate footer until the story is complete', () => {
    render(<CampaignStoryPage initialStory={incomplete} />)
    expect(footerLink()).not.toBeInTheDocument()
  })

  it('shows the generate footer linking to the plan when complete', () => {
    render(<CampaignStoryPage initialStory={complete} />)
    expect(footerLink()).toHaveAttribute('href', '/dashboard/campaign-plan')
  })
})
