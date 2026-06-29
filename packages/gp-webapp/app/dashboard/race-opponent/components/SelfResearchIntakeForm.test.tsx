import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import SelfResearchIntakeForm from './SelfResearchIntakeForm'

describe('<SelfResearchIntakeForm>', () => {
  it('blocks submit and shows errors when required fields are empty', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(<SelfResearchIntakeForm submitting={false} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: /run self-research/i }))

    await waitFor(() =>
      expect(screen.getByText(/full name is required/i)).toBeInTheDocument(),
    )
    expect(
      screen.getByText(/office you are running for is required/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/district or jurisdiction is required/i),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the trimmed values once the required fields are filled', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()

    render(<SelfResearchIntakeForm submitting={false} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/full name/i), '  Jane Candidate  ')
    await user.type(
      screen.getByLabelText(/office you are running for/i),
      'City Council',
    )
    await user.type(
      screen.getByLabelText(/district or jurisdiction/i),
      'District 4',
    )

    await user.click(screen.getByRole('button', { name: /run self-research/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: 'Jane Candidate',
        office: 'City Council',
        district: 'District 4',
      }),
    )
  })
})
