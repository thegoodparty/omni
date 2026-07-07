import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import type { RaceOpponentStandoutAction } from 'gpApi/api-endpoints'
import StandoutActionsSection from './StandoutActionsSection'

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
})
