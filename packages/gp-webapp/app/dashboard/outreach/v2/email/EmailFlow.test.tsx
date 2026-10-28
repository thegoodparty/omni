import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { EmailFlow } from './EmailFlow'

const sender = {
  localPart: 'renee.wells',
  address: 'renee.wells@outreachmail.goodparty.org',
  displayName: 'Renee Wells',
  forwardToEmail: 'renee@example.com',
  pendingForwardToEmail: null,
  warmingStep: 0,
}

const draft = {
  id: 11,
  status: 'draft',
  goal: 'Introduce myself to voters',
  layout: 'newsletter',
  theme: 'classic_blue',
  subject: 'Hello',
  headline: null,
  body: 'Hi there',
  imageUrl: null,
  buttonLabel: null,
  buttonUrl: null,
  paidForBy: null,
  date: null,
  consentConfirmedAt: null,
  recipientCount: 0,
}

const mockApi = () => {
  api.mock('GET /v1/outreach/email/sender', { status: 200, data: sender })
  const saves: unknown[] = []
  api.mock('POST /v1/outreach/email', ({ body }) => {
    saves.push(body)
    return { status: 200, data: draft }
  })
  api.mock('POST /v1/outreach/email/:id/recipients', {
    status: 200,
    data: { ready: 4800, invalid: 30, unsubscribed: 7, duplicate: 12 },
  })
  return saves
}

const fillCompose = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByText('Introduce myself to voters'))
  await user.type(await screen.findByLabelText('Subject'), 'Hello')
  const field = screen.getByLabelText('Message body')
  await user.click(field)
  await user.keyboard('Hi there')
}

// Typing into the message field scrolls to the cursor, which jsdom cannot
// measure.
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [],
  })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  })
})

describe('EmailFlow', () => {
  it('holds the goal step until a goal is picked and names the placeholders', async () => {
    mockApi()
    render(<EmailFlow open onClose={vi.fn()} />)

    expect(screen.getByText('What do you want to do?')).toBeInTheDocument()

    await userEvent
      .setup()
      .click(screen.getByText('Introduce myself to voters'))

    expect(await screen.findByLabelText('Subject')).toBeInTheDocument()
    expect(screen.getByTestId('email-coming-soon-ai-draft')).toBeInTheDocument()
    expect(screen.getByTestId('email-coming-soon-image')).toBeInTheDocument()
  })

  it('saves the draft, uploads the list and shows the cap copy', async () => {
    const saves = mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await fillCompose(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).toMatchObject({
      goal: 'Introduce myself to voters',
      subject: 'Hello',
      layout: 'newsletter',
    })

    await screen.findByText('Who do you want to reach?')
    const file = new File(['email\na@b.com'], 'list.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Your list (CSV)'), file)
    await user.click(
      screen.getByLabelText(
        'These people agreed to get email from my campaign.',
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Check my list' }))

    expect(
      await screen.findByText('4,800 ready, 37 skipped, 12 duplicates'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/This send can reach up to 1,000 people/),
    ).toBeInTheDocument()
    expect(screen.getByText('1,000 of 4,800')).toBeInTheDocument()
  })

  it('reaches review with the reply-to line and the placeholders', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await fillCompose(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Who do you want to reach?')
    await user.upload(
      screen.getByLabelText('Your list (CSV)'),
      new File(['email\na@b.com'], 'list.csv', { type: 'text/csv' }),
    )
    await user.click(
      screen.getByLabelText(
        'These people agreed to get email from my campaign.',
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Check my list' }))
    await screen.findByTestId('email-upload-summary')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByText('When should it go out?')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByText('Ready to send?')
    expect(
      await screen.findByText(/Replies go to renee@example.com/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
    for (const feature of ['test-send', 'price', 'pay']) {
      expect(
        screen.getByTestId(`email-coming-soon-${feature}`),
      ).toBeInTheDocument()
    }
  })
})
