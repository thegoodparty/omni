import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SharePlanModal from './SharePlanModal'

vi.mock('@styleguide/hooks/use-mobile', () => ({
  useIsMobile: vi.fn(() => false),
}))

const url = 'https://gp-api-dev.goodparty.org/v1/campaign-plan-shares/7/x.pdf'

describe('SharePlanModal', () => {
  it('resolves the share url on open and enables copy', async () => {
    const getShareUrl = vi.fn().mockResolvedValue(url)
    render(
      <SharePlanModal
        open
        onClose={vi.fn()}
        candidateName="Ada Person"
        getShareUrl={getShareUrl}
      />,
    )
    expect(getShareUrl).toHaveBeenCalledTimes(1)
    const copyButton = await screen.findByRole('button', {
      name: /copy link/i,
    })
    await waitFor(() => expect(copyButton).toBeEnabled())
  })

  it('shows an error state with retry when generation fails', async () => {
    const getShareUrl = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(url)
    render(
      <SharePlanModal
        open
        onClose={vi.fn()}
        candidateName="Ada Person"
        getShareUrl={getShareUrl}
      />,
    )
    const retry = await screen.findByRole('button', { name: /try again/i })
    await userEvent.click(retry)
    await screen.findByRole('button', { name: /copy link/i })
    expect(getShareUrl).toHaveBeenCalledTimes(2)
  })

  it('does not render social buttons', async () => {
    const getShareUrl = vi.fn().mockResolvedValue(url)
    render(
      <SharePlanModal
        open
        onClose={vi.fn()}
        candidateName="Ada Person"
        getShareUrl={getShareUrl}
      />,
    )
    await screen.findByRole('button', { name: /copy link/i })
    expect(screen.queryByText(/facebook/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/instagram/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^x$/i)).not.toBeInTheDocument()
  })
})
