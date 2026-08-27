import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BallotStatus, Campaign } from 'helpers/types'
import GetOnBallotCard from './GetOnBallotCard'

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: vi.fn(),
}))
import { useCampaign } from '@shared/hooks/useCampaign'
const mockCampaign = vi.mocked(useCampaign)

const withBallotStatus = (ballotStatus?: BallotStatus) =>
  mockCampaign.mockReturnValue([
    { ballotStatus, details: {}, data: {} } as Campaign,
  ])

describe('GetOnBallotCard', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('prompts the candidate who has qualified but not filed', async () => {
    withBallotStatus('qualified-not-filed')
    const onGetOnBallot = vi.fn()
    const user = userEvent.setup()
    render(<GetOnBallotCard onGetOnBallot={onGetOnBallot} />)

    expect(
      screen.getByText("Great. Let's get you on the ballot"),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Show me how to file' }),
    )
    expect(onGetOnBallot).toHaveBeenCalledTimes(1)
  })

  it('renders nothing for the answers that are already on or off the path', () => {
    for (const status of ['on-ballot', 'testing'] as const) {
      withBallotStatus(status)
      const { container } = render(<GetOnBallotCard onGetOnBallot={vi.fn()} />)
      expect(container).toBeEmptyDOMElement()
    }
  })

  it('asks what it takes for the candidate who is still considering', async () => {
    withBallotStatus('considering')
    const onGetOnBallot = vi.fn()
    const user = userEvent.setup()
    render(<GetOnBallotCard onGetOnBallot={onGetOnBallot} />)

    expect(
      screen.getByText("Let's see what it takes to get on the ballot"),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Show me what it takes' }),
    )
    expect(onGetOnBallot).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when the candidate never answered', () => {
    withBallotStatus(undefined)
    const { container } = render(<GetOnBallotCard onGetOnBallot={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stays hidden once skipped', async () => {
    withBallotStatus('qualified-not-filed')
    const user = userEvent.setup()
    const first = render(<GetOnBallotCard onGetOnBallot={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /more/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Skip' }))
    expect(first.container).toBeEmptyDOMElement()

    const second = render(<GetOnBallotCard onGetOnBallot={vi.fn()} />)
    expect(second.container).toBeEmptyDOMElement()
  })
})
