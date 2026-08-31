import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import ServeChannelCards from './ServeChannelCards'

const mockRouterPush = vi.fn()
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: mockRouterPush }),
}))

describe('ServeChannelCards', () => {
  it('renders exactly the three Serve channel cards', () => {
    render(<ServeChannelCards />)

    expect(screen.getByText('Social media')).toBeInTheDocument()
    expect(screen.getByText('Phone banking')).toBeInTheDocument()
    expect(screen.getByText('Door knocking')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('never renders SMS, Robocall, or pricing copy', () => {
    render(<ServeChannelCards />)

    expect(screen.queryByText(/texting/i)).not.toBeInTheDocument()
    expect(screen.queryByText('SMS')).not.toBeInTheDocument()
    expect(screen.queryByText('Robocall')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument()
  })

  it('clicking a card triggers no navigation', async () => {
    render(<ServeChannelCards />)

    await userEvent.click(screen.getByText('Social media'))
    await userEvent.click(screen.getByText('Phone banking'))
    await userEvent.click(screen.getByText('Door knocking'))

    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('renders every card as non-interactive', () => {
    render(<ServeChannelCards />)

    screen.getAllByRole('button').forEach((card) => {
      expect(card).toBeDisabled()
    })
  })
})
