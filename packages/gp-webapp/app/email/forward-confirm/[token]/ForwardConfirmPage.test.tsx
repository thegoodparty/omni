import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { ForwardConfirmPage } from './ForwardConfirmPage'

const data = { senderName: 'Renee Wells', forwardToEmail: 'new@example.com' }

describe('ForwardConfirmPage', () => {
  it('loads the address and confirms only on the button', async () => {
    let posts = 0
    api.mock('GET /v1/email/forward-confirm/:token', { status: 200, data })
    api.mock('POST /v1/email/forward-confirm', ({ body }) => {
      posts += 1
      expect(body).toEqual({ token: 'tok' })
      return { status: 200, data }
    })
    const user = userEvent.setup()
    render(<ForwardConfirmPage token="tok" />)

    expect(
      await screen.findByText('Send replies to new@example.com?'),
    ).toBeInTheDocument()
    expect(posts).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(
      await screen.findByText('Replies will go to this address.'),
    ).toBeInTheDocument()
    expect(posts).toBe(1)
  })

  it('says the link is not valid for a bad token', async () => {
    api.mock('GET /v1/email/forward-confirm/:token', {
      status: 400,
      data: { message: 'This link is not valid' },
    })
    render(<ForwardConfirmPage token="bad" />)
    expect(await screen.findByText("This link isn't valid")).toBeInTheDocument()
  })
})
