import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { CampaignStorySection } from './CampaignStoryCard'
import CampaignStoryPage from './CampaignStoryPage'

vi.mock('../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@shared/experiments/FeatureFlagGuard', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
// Expose buttons that fire onAnsweredChange so tests can drive the dynamic
// footer the same way real card saves would.
vi.mock('./CampaignStoryCard', () => ({
  default: ({
    section,
    onAnsweredChange,
  }: {
    section: CampaignStorySection
    onAnsweredChange?: (answered: boolean) => void
  }) => (
    <div>
      <button type="button" onClick={() => onAnsweredChange?.(true)}>
        answer-{section.id}
      </button>
      <button type="button" onClick={() => onAnsweredChange?.(false)}>
        clear-{section.id}
      </button>
    </div>
  ),
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

  it('reveals the footer once every card reports answered', async () => {
    const user = userEvent.setup()
    render(<CampaignStoryPage initialStory={incomplete} />)
    expect(footerLink()).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'answer-background' }))
    await user.click(screen.getByRole('button', { name: 'answer-issues' }))

    expect(footerLink()).toHaveAttribute('href', '/dashboard/campaign-plan')
  })

  it('hides the footer when a card reports it was cleared', async () => {
    const user = userEvent.setup()
    render(<CampaignStoryPage initialStory={complete} />)
    expect(footerLink()).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'clear-why' }))

    expect(footerLink()).not.toBeInTheDocument()
  })
})
