import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import ServeChannelCards from './ServeChannelCards'

describe('ServeChannelCards', () => {
  it('renders exactly the three Serve channel cards', () => {
    render(<ServeChannelCards onSocialClick={vi.fn()} />)

    expect(screen.getByText('Social media')).toBeInTheDocument()
    expect(screen.getByText('Phone banking')).toBeInTheDocument()
    expect(screen.getByText('Door knocking')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('never renders SMS, Robocall, or pricing copy', () => {
    render(<ServeChannelCards onSocialClick={vi.fn()} />)

    expect(screen.queryByText(/texting/i)).not.toBeInTheDocument()
    expect(screen.queryByText('SMS')).not.toBeInTheDocument()
    expect(screen.queryByText('Robocall')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument()
  })

  it('opens the social flow when the Social media card is clicked', async () => {
    const onSocialClick = vi.fn()
    render(<ServeChannelCards onSocialClick={onSocialClick} />)

    await userEvent.click(screen.getByText('Social media'))

    expect(onSocialClick).toHaveBeenCalledTimes(1)
  })

  it('only the Social media card is enabled — Phone banking and Door knocking stay disabled and inert', async () => {
    const onSocialClick = vi.fn()
    render(<ServeChannelCards onSocialClick={onSocialClick} />)

    expect(screen.getByRole('button', { name: /Social media/ })).toBeEnabled()
    const phoneBanking = screen.getByRole('button', { name: /Phone banking/ })
    const doorKnocking = screen.getByRole('button', { name: /Door knocking/ })
    expect(phoneBanking).toBeDisabled()
    expect(doorKnocking).toBeDisabled()

    await userEvent.click(phoneBanking)
    await userEvent.click(doorKnocking)

    expect(onSocialClick).not.toHaveBeenCalled()
  })
})
