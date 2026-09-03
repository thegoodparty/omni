import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import ServeChannelCards from './ServeChannelCards'

const renderCards = () => {
  const onSocialClick = vi.fn()
  const onPhoneBankingClick = vi.fn()
  const onDoorKnockingClick = vi.fn()
  render(
    <ServeChannelCards
      onSocialClick={onSocialClick}
      onPhoneBankingClick={onPhoneBankingClick}
      onDoorKnockingClick={onDoorKnockingClick}
    />,
  )
  return { onSocialClick, onPhoneBankingClick, onDoorKnockingClick }
}

describe('ServeChannelCards', () => {
  // Three, because door knocking is wired for Serve as of 3.0: every turf now
  // gets an `Outreach` envelope, so an elected official's lists have somewhere
  // to live and a rail of their own to live on.
  it('renders exactly the three Serve channel cards', () => {
    renderCards()

    expect(screen.getByText('Social media')).toBeInTheDocument()
    expect(screen.getByText('Phone banking')).toBeInTheDocument()
    expect(screen.getByText('Door knocking')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  // The two paid channels stay out. An elected official has no campaign to
  // bill, and pricing copy on this page would be describing a purchase they
  // cannot make.
  it('never renders SMS, Robocall, or pricing copy', () => {
    renderCards()

    expect(screen.queryByText(/texting/i)).not.toBeInTheDocument()
    expect(screen.queryByText('SMS')).not.toBeInTheDocument()
    expect(screen.queryByText('Robocall')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument()
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
})
