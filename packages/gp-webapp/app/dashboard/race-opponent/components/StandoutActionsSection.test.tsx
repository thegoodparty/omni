import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { RaceOpponentStandoutAction } from 'gpApi/api-endpoints'
import StandoutActionsSection from './StandoutActionsSection'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

let mockCampaign: { id: number } | undefined = { id: 42 }
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [mockCampaign],
}))

const actionFor = (n: number): RaceOpponentStandoutAction => ({
  title: `Action title ${n}`,
  body: `Action body ${n}`,
  smsMessage: `Sms message ${n}`,
  opponentName: 'Jane Rival',
  issue: `Issue ${n}`,
})

const fiveActions: RaceOpponentStandoutAction[] = [1, 2, 3, 4, 5].map(actionFor)

beforeEach(() => {
  vi.clearAllMocks()
  mockCampaign = { id: 42 }
})

describe('<StandoutActionsSection>', () => {
  it('renders five cards with the "5 ways to stand out" heading and subtitle', () => {
    render(<StandoutActionsSection standoutActions={fiveActions} />)

    expect(
      screen.getByRole('heading', { name: '5 ways to stand out' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'These actions will help you show voters where you stand out against the opposition.',
      ),
    ).toBeInTheDocument()

    expect(
      screen.getAllByRole('button', { name: 'Send SMS to voters' }),
    ).toHaveLength(5)
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByText(`Action title ${n}`)).toBeInTheDocument()
      expect(screen.getByText(`Action body ${n}`)).toBeInTheDocument()
    }
    expect(screen.getAllByText('Voter outreach')).toHaveLength(5)
  })

  it('renders the dynamic heading for fewer than five cards', () => {
    render(<StandoutActionsSection standoutActions={fiveActions.slice(0, 3)} />)

    expect(
      screen.getByRole('heading', { name: '3 ways to stand out' }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Send SMS to voters' }),
    ).toHaveLength(3)
  })

  it('renders nothing for an empty standoutActions array', () => {
    const { container } = render(
      <StandoutActionsSection standoutActions={[]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a null standoutActions', () => {
    const { container } = render(
      <StandoutActionsSection standoutActions={null} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an undefined standoutActions', () => {
    const { container } = render(
      <StandoutActionsSection standoutActions={undefined} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('pushes the outreach compose deep link with the sms message URL-encoded', async () => {
    const user = userEvent.setup()
    const action: RaceOpponentStandoutAction = {
      ...actionFor(1),
      smsMessage: 'Vote for me & my plan? Yes!',
    }
    render(<StandoutActionsSection standoutActions={[action]} />)

    await user.click(screen.getByRole('button', { name: 'Send SMS to voters' }))

    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/outreach?compose=text&message=Vote%20for%20me%20%26%20my%20plan%3F%20Yes!',
    )
  })

  it('renders title and body verbatim when opponentName is null', () => {
    const action: RaceOpponentStandoutAction = {
      title: 'Knock the north precincts',
      body: 'Contrast your housing plan with the field.',
      smsMessage: 'Hi, this is a message.',
      opponentName: null,
      issue: 'Housing',
    }
    render(<StandoutActionsSection standoutActions={[action]} />)

    expect(screen.getByText('Knock the north precincts')).toBeInTheDocument()
    expect(
      screen.getByText('Contrast your housing plan with the field.'),
    ).toBeInTheDocument()
  })

  it('fires the viewed event exactly once when cards render', () => {
    render(<StandoutActionsSection standoutActions={fiveActions} />)

    const viewedCalls = vi
      .mocked(trackEvent)
      .mock.calls.filter(
        ([name]) => name === EVENTS.RaceOpponent.StandoutActionsViewed,
      )
    expect(viewedCalls).toHaveLength(1)
    expect(viewedCalls[0]?.[1]).toEqual({ campaignId: 42, actionCount: 5 })
  })

  it('does not fire the viewed event for empty or nullish actions', () => {
    render(<StandoutActionsSection standoutActions={[]} />)
    render(<StandoutActionsSection standoutActions={null} />)
    render(<StandoutActionsSection standoutActions={undefined} />)

    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('waits for the campaign to resolve before firing viewed with the real id', () => {
    mockCampaign = undefined
    const { rerender } = render(
      <StandoutActionsSection standoutActions={fiveActions} />,
    )
    expect(trackEvent).not.toHaveBeenCalled()

    mockCampaign = { id: 42 }
    rerender(<StandoutActionsSection standoutActions={fiveActions} />)
    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.RaceOpponent.StandoutActionsViewed,
      { campaignId: 42, actionCount: 5 },
    )
  })

  it('does not re-fire the viewed event on a re-render of the same mount', () => {
    const { rerender } = render(
      <StandoutActionsSection standoutActions={fiveActions} />,
    )
    rerender(
      <StandoutActionsSection standoutActions={fiveActions.map((a) => a)} />,
    )

    const viewedCalls = vi
      .mocked(trackEvent)
      .mock.calls.filter(
        ([name]) => name === EVENTS.RaceOpponent.StandoutActionsViewed,
      )
    expect(viewedCalls).toHaveLength(1)
  })

  it('fires the clicked event with the card properties on CTA click', async () => {
    const user = userEvent.setup()
    render(<StandoutActionsSection standoutActions={fiveActions.slice(0, 3)} />)

    const buttons = screen.getAllByRole('button', {
      name: 'Send SMS to voters',
    })
    await user.click(buttons[2]!)

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.RaceOpponent.StandoutActionClicked,
      {
        campaignId: 42,
        order: 2,
        issue: 'Issue 3',
        opponentName: 'Jane Rival',
        messageLength: 'Sms message 3'.length,
      },
    )
  })

  it('omits the opponentName key from the clicked event when null', async () => {
    const user = userEvent.setup()
    const action: RaceOpponentStandoutAction = {
      ...actionFor(1),
      opponentName: null,
    }
    render(<StandoutActionsSection standoutActions={[action]} />)

    await user.click(screen.getByRole('button', { name: 'Send SMS to voters' }))

    const clickedCall = vi
      .mocked(trackEvent)
      .mock.calls.find(
        ([name]) => name === EVENTS.RaceOpponent.StandoutActionClicked,
      )
    expect(clickedCall?.[1]).toEqual({
      campaignId: 42,
      order: 0,
      issue: 'Issue 1',
      messageLength: 'Sms message 1'.length,
    })
    expect(clickedCall?.[1]).not.toHaveProperty('opponentName')
  })

  it('fires the clicked event before navigating', async () => {
    const user = userEvent.setup()
    render(<StandoutActionsSection standoutActions={[actionFor(1)]} />)

    await user.click(screen.getByRole('button', { name: 'Send SMS to voters' }))

    const clickedOrder = vi.mocked(trackEvent).mock.invocationCallOrder.at(-1)!
    const pushOrder = vi.mocked(router.push!).mock.invocationCallOrder[0]!
    expect(router.push).toHaveBeenCalledTimes(1)
    expect(clickedOrder).toBeLessThan(pushOrder)
  })
})
