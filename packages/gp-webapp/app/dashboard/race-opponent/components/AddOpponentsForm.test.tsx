import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import AddOpponentsForm from './AddOpponentsForm'

describe('<AddOpponentsForm>', () => {
  it('starts with both buttons disabled and no Remove control on a single row', () => {
    render(<AddOpponentsForm submitting={false} onSubmit={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: /add another opponent/i }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /run the analysis/i }),
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: /remove/i }),
    ).not.toBeInTheDocument()
  })

  it('enables both buttons once Opponent 1 has a name', async () => {
    const user = userEvent.setup()
    render(<AddOpponentsForm submitting={false} onSubmit={vi.fn()} />)

    await user.type(screen.getByLabelText('Name'), 'Jane Doe')

    expect(
      screen.getByRole('button', { name: /add another opponent/i }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: /run the analysis/i }),
    ).toBeEnabled()
  })

  it('adds and removes opponent rows', async () => {
    const user = userEvent.setup()
    render(<AddOpponentsForm submitting={false} onSubmit={vi.fn()} />)

    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    await user.click(
      screen.getByRole('button', { name: /add another opponent/i }),
    )

    expect(screen.getByText('Opponent 2')).toBeInTheDocument()
    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    expect(removeButtons).toHaveLength(2)

    await user.click(removeButtons[1]!)
    expect(screen.queryByText('Opponent 2')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /remove/i }),
    ).not.toBeInTheDocument()
  })

  it('blocks submit and shows an inline error for a non-https URL', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<AddOpponentsForm submitting={false} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    await user.type(screen.getByLabelText(/website/i), 'http://janedoe.com')
    await user.click(screen.getByRole('button', { name: /run the analysis/i }))

    await waitFor(() =>
      expect(screen.getByText(/valid https url/i)).toBeInTheDocument(),
    )
    expect(onSubmit).not.toHaveBeenCalled()

    // The errored field is marked invalid and points a screen reader at its
    // message via aria-describedby, so the error is announced, not just shown.
    const websiteInput = screen.getByLabelText(/website/i)
    expect(websiteInput).toHaveAttribute('aria-invalid', 'true')
    const describedBy = websiteInput.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /valid https url/i,
    )
  })

  it('submits trimmed named rows with optional https URLs', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<AddOpponentsForm submitting={false} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Name'), '  Jane Doe  ')
    await user.type(
      screen.getByLabelText(/ballotpedia page/i),
      'https://ballotpedia.org/Jane_Doe',
    )
    await user.click(screen.getByRole('button', { name: /run the analysis/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith([
      {
        name: 'Jane Doe',
        ballotpediaUrl: 'https://ballotpedia.org/Jane_Doe',
        website: undefined,
      },
    ])
  })

  it('omits unnamed rows from the submitted payload', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<AddOpponentsForm submitting={false} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    await user.click(
      screen.getByRole('button', { name: /add another opponent/i }),
    )
    // Second row left blank — it must not be sent.
    await user.click(screen.getByRole('button', { name: /run the analysis/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith([
      { name: 'Jane Doe', ballotpediaUrl: undefined, website: undefined },
    ])
  })

  it('acknowledges a completed run and hides the entry fields behind a disclosure', async () => {
    const user = userEvent.setup()
    render(
      <AddOpponentsForm submitting={false} onSubmit={vi.fn()} ranAlready />,
    )

    expect(
      screen.getByText(/no opponents found in this analysis/i),
    ).toBeInTheDocument()
    // Fields and the submit start hidden — no always-live fresh-submit.
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /run the analysis/i }),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /add opponents manually/i }),
    )
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /run the analysis/i }),
    ).toBeInTheDocument()
  })
})
