import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import ServeChannelCards from './ServeChannelCards'

const renderCards = () => {
  const onSocialClick = vi.fn()
  const onPhoneBankingClick = vi.fn()
  render(
    <ServeChannelCards
      onSocialClick={onSocialClick}
      onPhoneBankingClick={onPhoneBankingClick}
    />,
  )
  return { onSocialClick, onPhoneBankingClick }
}

describe('ServeChannelCards', () => {
  it('renders exactly the two Serve channel cards', () => {
    renderCards()

    expect(screen.getByText('Social media')).toBeInTheDocument()
    expect(screen.getByText('Phone banking')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('never renders SMS, Robocall, Door knocking, or pricing copy', () => {
    renderCards()

    expect(screen.queryByText(/texting/i)).not.toBeInTheDocument()
    expect(screen.queryByText('SMS')).not.toBeInTheDocument()
    expect(screen.queryByText('Robocall')).not.toBeInTheDocument()
    expect(screen.queryByText('Door knocking')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument()
  })

  it('opens the social flow when the Social media card is clicked', async () => {
    const { onSocialClick, onPhoneBankingClick } = renderCards()

    await userEvent.click(screen.getByText('Social media'))

    expect(onSocialClick).toHaveBeenCalledTimes(1)
    expect(onPhoneBankingClick).not.toHaveBeenCalled()
  })

  it('opens the phone banking flow when the Phone banking card is clicked', async () => {
    const { onSocialClick, onPhoneBankingClick } = renderCards()

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onPhoneBankingClick).toHaveBeenCalledTimes(1)
    expect(onSocialClick).not.toHaveBeenCalled()
  })

  it('both cards are enabled', () => {
    renderCards()

    expect(screen.getByRole('button', { name: /Social media/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Phone banking/ })).toBeEnabled()
  })
})
