import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { UnsubscribePage } from './UnsubscribePage'

const state = (mode: 'win' | 'serve', unsubscribed: boolean) => ({
  status: 200 as const,
  data: { senderName: 'Renee Wells', mode, unsubscribed },
})

describe('UnsubscribePage', () => {
  it('loads without changing anything, then unsubscribes on the button', async () => {
    let posts = 0
    api.mock('GET /v1/email/unsubscribe', ({ query }) => {
      expect(query).toEqual({ t: 'tok' })
      return state('win', false)
    })
    api.mock('POST /v1/email/unsubscribe', ({ body }) => {
      posts += 1
      expect(body).toEqual({ token: 'tok' })
      return state('win', true)
    })
    const user = userEvent.setup()
    render(<UnsubscribePage token="tok" />)

    expect(
      await screen.findByText('Stop email from Renee Wells?'),
    ).toBeInTheDocument()
    expect(posts).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    expect(await screen.findByText("You're unsubscribed.")).toBeInTheDocument()
    expect(posts).toBe(1)
  })

  it('undoes an unsubscribe', async () => {
    api.mock('GET /v1/email/unsubscribe', state('win', true))
    api.mock('POST /v1/email/unsubscribe/undo', state('win', false))
    const user = userEvent.setup()
    render(<UnsubscribePage token="tok" />)

    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(
      await screen.findByText(/back on the list for this campaign/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Unsubscribe' }),
    ).toBeInTheDocument()
  })

  it('names an office, not a campaign, for a Serve sender', async () => {
    api.mock('GET /v1/email/unsubscribe', state('serve', false))
    render(<UnsubscribePage token="tok" />)
    expect(
      await screen.findByText(/hearing from this office/),
    ).toBeInTheDocument()
  })

  it('says the link is not valid for a bad token', async () => {
    api.mock('GET /v1/email/unsubscribe', {
      status: 400,
      data: { message: 'This link is not valid' },
    })
    render(<UnsubscribePage token="bad" />)
    expect(await screen.findByText("This link isn't valid")).toBeInTheDocument()
  })
})
