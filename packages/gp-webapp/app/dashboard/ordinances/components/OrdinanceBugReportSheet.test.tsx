import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OrdinanceBugReportSheet from './OrdinanceBugReportSheet'

describe('OrdinanceBugReportSheet', () => {
  it('renders the flagged excerpt and disables submit until a description is typed', async () => {
    const user = userEvent.setup()
    render(
      <OrdinanceBugReportSheet
        open
        excerpt="No permit fee shall exceed twenty-five dollars."
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(
      screen.getByText('No permit fee shall exceed twenty-five dollars.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()

    await user.type(
      screen.getByPlaceholderText('Describe the problem…'),
      'Wrong figure.',
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
  })

  it('submits the description and closes on success', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(
      <OrdinanceBugReportSheet
        open
        excerpt="passage"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Describe the problem…'),
      'This is broken.',
    )
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith('This is broken.'),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an error and stays open when submission fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('nope'))
    const onClose = vi.fn()
    render(
      <OrdinanceBugReportSheet
        open
        excerpt="passage"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Describe the problem…'),
      'This is broken.',
    )
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't submit. Please try again.",
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
