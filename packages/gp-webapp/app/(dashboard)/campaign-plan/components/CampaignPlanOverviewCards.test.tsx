import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import CampaignPlanOverviewCards from './CampaignPlanOverviewCards'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

describe('CampaignPlanOverviewCards', () => {
  it('links each card to where it can be edited', () => {
    render(<CampaignPlanOverviewCards />)

    expect(screen.getByRole('link', { name: /Your race/ })).toHaveAttribute(
      'href',
      '/profile',
    )
    expect(screen.getByRole('link', { name: /Your story/ })).toHaveAttribute(
      'href',
      '/campaign-story',
    )
    expect(
      screen.getByRole('link', { name: /Your opponents/ }),
    ).toHaveAttribute('href', '/race-opponent')
  })

  it('records which card was opened', async () => {
    render(<CampaignPlanOverviewCards />)

    await userEvent.click(screen.getByRole('link', { name: /Your opponents/ }))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Dashboard.CampaignPlan.OverviewCardClicked,
      { card: 'opponents' },
    )
  })
})
