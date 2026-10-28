import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { EmailFlow } from './EmailFlow'
import { SERVE_EMAIL_SURFACE } from './emailSurface'

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmSetup: vi.fn() }),
  useElements: () => ({}),
}))

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

const sendShape = {
  ...draft,
  recipientCap: null,
  sentCount: 0,
  pauseReason: null,
  stopping: false,
  estimate: null,
}

const mockApi = () => {
  // Registered first so `/sender` is not read as an id.
  api.mock('GET /v1/outreach/email/:id', {
    status: 200,
    data: {
      ...draft,
      recipientCap: null,
      sentCount: 0,
      pauseReason: null,
      stopping: false,
      estimate: { warmingCap: 1000, recipientCap: 1000, priceCents: 1000 },
    },
  })
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
  api.mock('POST /v1/outreach/email/:id/confirm', {
    status: 200,
    data: {
      outcome: 'scheduled',
      declineCode: null,
      email: { ...sendShape, status: 'pending', estimate: null },
    },
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
  afterEach(() => vi.restoreAllMocks())

  it('holds the goal step until a goal is picked and shows the compose controls', async () => {
    mockApi()
    render(<EmailFlow open onClose={vi.fn()} />)

    expect(screen.getByText('What do you want to do?')).toBeInTheDocument()

    await userEvent
      .setup()
      .click(screen.getByText('Introduce myself to voters'))

    expect(await screen.findByLabelText('Subject')).toBeInTheDocument()
    expect(screen.getByTestId('email-ai-draft')).toBeInTheDocument()
    expect(screen.getByTestId('email-image')).toBeInTheDocument()
  })

  it('drafts with AI, sending the goal and tone, and fills the fields', async () => {
    mockApi()
    const requests: unknown[] = []
    api.mock('POST /v1/outreach/email/draft', ({ body }) => {
      requests.push(body)
      return {
        status: 200,
        data: {
          subject: 'Meet your neighbor',
          headline: 'Hello',
          body: 'Hi {{first_name}}, I am running.',
          buttonLabel: null,
        },
      }
    })
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await user.click(screen.getByText('Introduce myself to voters'))
    await user.click(await screen.findByText('Urgent'))
    await user.click(screen.getByRole('button', { name: 'Draft it with AI' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Subject')).toHaveValue(
        'Meet your neighbor',
      ),
    )
    expect(requests[0]).toEqual({
      goal: 'Introduce myself to voters',
      tone: 'urgent',
      layout: 'newsletter',
    })
    expect(
      screen.getByRole('button', { name: 'Regenerate' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Improve with AI' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({
      currentDraft: { subject: 'Meet your neighbor', headline: 'Hello' },
    })
  })

  it('shows the API error when the AI draft fails', async () => {
    mockApi()
    api.mock('POST /v1/outreach/email/draft', {
      status: 502,
      data: { message: 'We could not draft that. Try again.' },
    })
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await user.click(screen.getByText('Introduce myself to voters'))
    await user.click(
      await screen.findByRole('button', { name: 'Draft it with AI' }),
    )

    expect(
      await screen.findByText('We could not draft that. Try again.'),
    ).toBeInTheDocument()
  })

  it('uploads the image to the presigned URL and saves the public URL', async () => {
    const saves = mockApi()
    const publicUrl = 'https://assets.example.com/email-images/org/abc.png'
    api.mock('POST /v1/outreach/email/images/presign', {
      status: 200,
      data: {
        url: 'https://s3.example.com/bucket',
        fields: {
          key: 'email-images/org/abc.png',
          'Content-Type': 'image/png',
        },
        publicUrl,
        expiresIn: 600,
      },
    })
    const posted: FormData[] = []
    const realFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === 'https://s3.example.com/bucket') {
        posted.push(init?.body as FormData)
        return new Response(null, { status: 204 })
      }
      return realFetch(input, init)
    })
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await fillCompose(user)
    await user.upload(
      screen.getByLabelText('Image (optional)'),
      new File(['x'], 'logo.png', { type: 'image/png' }),
    )
    await screen.findByRole('button', { name: 'Remove image' })
    expect([...posted[0]!.keys()]).toEqual(['key', 'Content-Type', 'file'])

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).toMatchObject({ imageUrl: publicUrl })
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

  it('reaches review with the reply-to line and the price', async () => {
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
    expect(await screen.findByTestId('email-price')).toHaveTextContent(
      'Up to $10.00',
    )
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' }),
    )
    expect(
      await screen.findByText('How do you want to pay?'),
    ).toBeInTheDocument()
  })

  it('sends a test email for the saved draft from the review step', async () => {
    mockApi()
    api.mock('POST /v1/outreach/email/:id/test', {
      status: 200,
      data: { sentTo: 'renee@example.com' },
    })
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

    await user.click(screen.getByRole('button', { name: 'Send me a test' }))
    expect(
      await screen.findByText('Test sent to renee@example.com.'),
    ).toBeInTheDocument()
  })

  it('sends the Serve surface through the office-scoped routes with constituent copy', async () => {
    api.mock('GET /v1/outreach/serve/email/sender', {
      status: 200,
      data: sender,
    })
    api.mock('POST /v1/outreach/serve/email', { status: 200, data: draft })
    api.mock('POST /v1/outreach/serve/email/:id/recipients', {
      status: 200,
      data: { ready: 40, invalid: 0, unsubscribed: 0, duplicate: 0 },
    })
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} surface={SERVE_EMAIL_SURFACE} />)

    await user.click(screen.getByText('Introduce myself to constituents'))
    await user.type(await screen.findByLabelText('Subject'), 'Hello')
    await user.click(screen.getByLabelText('Message body'))
    await user.keyboard('Hi there')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByText('Who do you want to reach?')
    await user.upload(
      screen.getByLabelText('Your list (CSV)'),
      new File(['email\na@b.com'], 'list.csv', { type: 'text/csv' }),
    )
    await user.click(
      screen.getByLabelText('These people agreed to get email from my office.'),
    )
    await user.click(screen.getByRole('button', { name: 'Check my list' }))
    expect(
      await screen.findByText('40 ready, 0 skipped, 0 duplicates'),
    ).toBeInTheDocument()
  })
})
