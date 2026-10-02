import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { CommunityResourceLink } from './CommunityResourceLink'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

describe('<CommunityResourceLink>', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear()
  })

  it('shows the line for the purpose and opens the training in a new tab', () => {
    render(
      <CommunityResourceLink
        channel="phone-bank"
        purpose="introduce_myself"
        surface="flow"
      />,
    )

    expect(
      screen.getByText(/Make your introduction count\./),
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Open webinar' })
    expect(link).toHaveAttribute(
      'href',
      'https://goodpartyorg.circle.so/c/video-trainings/win-your-race-messaging-that-moves-voters',
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('reads off the channel while no purpose is picked yet', () => {
    render(
      <CommunityResourceLink channel="door" purpose={null} surface="flow" />,
    )

    expect(screen.getByText(/Heading to the doors\?/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open course' })).toHaveAttribute(
      'href',
      'https://goodpartyorg.circle.so/c/win/sections/980444/lessons/3719934',
    )
  })

  it('reports which training was opened from where', async () => {
    const user = userEvent.setup()
    render(
      <CommunityResourceLink
        channel="phone-bank"
        purpose="election_day_turnout"
        surface="caller"
      />,
    )

    await user.click(screen.getByRole('link', { name: 'Open course' }))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.CommunityResource.Opened,
      {
        channel: 'phone-bank',
        medium: 'phoneBanking',
        purpose: 'election_day_turnout',
        resource: 'gotv',
        surface: 'caller',
        product: 'win',
      },
    )
  })
})
