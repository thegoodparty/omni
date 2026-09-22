import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import ServeChannelCards from './ServeChannelCards'

// `onSmsClick` omitted by default: that is what the page passes while
// `serve-sms-outreach` is off or still resolving, so it is the shape most of
// these assertions are about. `showDoorKnocking` defaults on, which is the
// settled state of its own flag.
const renderCards = ({
  withSms = false,
  showDoorKnocking = true,
}: { withSms?: boolean; showDoorKnocking?: boolean } = {}) => {
  const onSocialClick = vi.fn()
  const onPhoneBankingClick = vi.fn()
  const onDoorKnockingClick = vi.fn()
  const onSmsClick = vi.fn()
  render(
    <ServeChannelCards
      onSocialClick={onSocialClick}
      onPhoneBankingClick={onPhoneBankingClick}
      onDoorKnockingClick={onDoorKnockingClick}
      onSmsClick={withSms ? onSmsClick : undefined}
      showDoorKnocking={showDoorKnocking}
    />,
  )
  return {
    onSocialClick,
    onPhoneBankingClick,
    onDoorKnockingClick,
    onSmsClick,
  }
}

describe('ServeChannelCards', () => {
  // Three without an SMS handler, because door knocking is wired for Serve as
  // of 3.0: every turf now gets an `Outreach` envelope, so an elected
  // official's lists have somewhere to live and a rail of their own to live
  // on.
  it('renders exactly the three ungated Serve channel cards', () => {
    renderCards()

    expect(screen.getByText('Social media')).toBeInTheDocument()
    expect(screen.getByText('Phone banking')).toBeInTheDocument()
    expect(screen.getByText('Door knocking')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  // No handler means the flag is off or still resolving, and a channel that
  // cannot be entered must not be advertised — not even greyed out.
  it('omits the SMS card entirely when no SMS handler is given', () => {
    renderCards()

    expect(screen.queryByText('SMS')).not.toBeInTheDocument()
    expect(screen.queryByText(/texting/i)).not.toBeInTheDocument()
  })

  // Robocall is the paid channel that stays out for good, and no card on this
  // page carries the candidate grid's per-message pricing sub-copy.
  it('never renders Robocall or pricing copy', () => {
    renderCards({ withSms: true })

    expect(screen.queryByText('Robocall')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument()
  })

  // Order matters: SMS sits second, where the candidate grid's TILE_ORDER
  // puts texting, so someone moving between the two products finds it in the
  // same place.
  it('renders the SMS card second when a handler is given', () => {
    renderCards({ withSms: true })

    const labels = screen.getAllByRole('button').map((b) => b.textContent)
    expect(labels).toEqual([
      'Social media',
      'SMS',
      'Phone banking',
      'Door knocking',
    ])
  })

  it('opens the SMS flow when the SMS card is clicked', async () => {
    const { onSmsClick, onSocialClick, onPhoneBankingClick } = renderCards({
      withSms: true,
    })

    await userEvent.click(screen.getByText('SMS'))

    expect(onSmsClick).toHaveBeenCalledTimes(1)
    expect(onSocialClick).not.toHaveBeenCalled()
    expect(onPhoneBankingClick).not.toHaveBeenCalled()
  })

  it('opens the social flow when the Social media card is clicked', async () => {
    const { onSocialClick, onPhoneBankingClick, onDoorKnockingClick } =
      renderCards()

    await userEvent.click(screen.getByText('Social media'))

    expect(onSocialClick).toHaveBeenCalledTimes(1)
    expect(onPhoneBankingClick).not.toHaveBeenCalled()
    expect(onDoorKnockingClick).not.toHaveBeenCalled()
  })

  it('opens the phone banking flow when the Phone banking card is clicked', async () => {
    const { onSocialClick, onPhoneBankingClick } = renderCards()

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onPhoneBankingClick).toHaveBeenCalledTimes(1)
    expect(onSocialClick).not.toHaveBeenCalled()
  })

  // The one channel whose card leaves this page rather than opening a flow on
  // it: door knocking's surface is the map, which decides Win-or-Serve for
  // itself from the same predicate its page gate uses.
  it('reports the door-knocking card so the page can navigate away', async () => {
    const { onDoorKnockingClick, onSocialClick } = renderCards()

    await userEvent.click(screen.getByText('Door knocking'))

    expect(onDoorKnockingClick).toHaveBeenCalledTimes(1)
    expect(onSocialClick).not.toHaveBeenCalled()
  })

  it('enables every card', () => {
    renderCards()

    expect(screen.getByRole('button', { name: /Social media/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Phone banking/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Door knocking/ })).toBeEnabled()
  })

  // Off the flag there is nothing behind the card: Serve has no eCanvasser
  // control arm, so the route it pushes renders a Win-only legacy dashboard.
  // Absent rather than disabled — a dead tile reads as broken.
  it('omits the door-knocking card when the native flag is off', () => {
    renderCards({ showDoorKnocking: false })

    expect(screen.queryByText('Door knocking')).not.toBeInTheDocument()
    expect(screen.getByText('Social media')).toBeInTheDocument()
    expect(screen.getByText('Phone banking')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})
