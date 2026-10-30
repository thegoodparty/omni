import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { EmailFlow } from './EmailFlow'
import { SERVE_EMAIL_SURFACE } from './emailSurface'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))

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
  voterFileFilterId: null,
  recipientCount: 0,
  content: {
    layout: 'long_update' as const,
    theme: 'classic_blue' as const,
    subject: 'Hello',
    blocks: [],
  },
}

const sendShape = {
  ...draft,
  recipientCap: null,
  sentCount: 0,
  pauseReason: null,
  stopping: false,
  estimate: null,
}

// The people with an email address in a saved list come off the list
// detail's email count, as robocall's landlines do.
const mockLists = (email: number) => {
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    data: [{ id: 1, name: 'Renters in 98103' }],
  })
  api.mock('GET /v1/contacts/list-detail', {
    status: 200,
    data: {
      demographics: { people: 6000, avgAge: null, avgIncome: null },
      reachability: {
        sms: 500,
        robocall: 500,
        phoneBanking: 500,
        doorKnocking: 700,
        email,
        polls: 500,
      },
      outreachHistory: [],
    },
  })
}

const pickList = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByText(/Choose a (voter|constituent) list/))
  await user.click(await screen.findByText('Renters in 98103'))
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
      estimate: {
        audienceCount: 4800,
        warmingCap: 1000,
        recipientCap: 1000,
        priceCents: 1000,
      },
    },
  })
  api.mock('GET /v1/outreach/email/sender', { status: 200, data: sender })
  const saves: unknown[] = []
  api.mock('POST /v1/outreach/email', ({ body }) => {
    saves.push(body)
    return { status: 200, data: draft }
  })
  mockLists(4800)
  api.mock('POST /v1/outreach/email/:id/confirm', {
    status: 200,
    data: {
      outcome: 'scheduled',
      email: { ...sendShape, status: 'pending', estimate: null },
    },
  })
  return saves
}

// The personal letter starts with three empty paragraphs: write the first
// and remove the other two.
const writeLetter = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText('Subject'), 'Hello')
  await user.click(screen.getByRole('textbox', { name: 'Paragraph 1' }))
  await user.keyboard('Hi there')
  await user.click(screen.getByRole('button', { name: 'Remove paragraph 3' }))
  await user.click(screen.getByRole('button', { name: 'Remove paragraph 2' }))
}

const fillCompose = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByText('Introduce myself to voters'))
  await writeLetter(user)
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
    expect(screen.getAllByTestId('email-block')).toHaveLength(3)
    expect(screen.getByTestId('email-add-block')).toBeInTheDocument()
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
          headline: null,
          body: 'Hi {{first_name}}, I am running.',
          buttonLabel: null,
          content: {
            layout: 'personal_letter',
            theme: 'cream_and_forest',
            subject: 'Meet your neighbor',
            blocks: [
              { type: 'paragraph', text: 'Hi {{first_name}}, I am running.' },
            ],
          },
        },
      }
    })
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await user.click(screen.getByText('Introduce myself to voters'))
    await waitFor(() =>
      expect(screen.getByLabelText('Subject')).toHaveValue(
        'Meet your neighbor',
      ),
    )
    expect(requests).toHaveLength(1)
    await user.click(screen.getByText('Urgent'))
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toEqual({
      goal: 'Introduce myself to voters',
      tone: 'urgent',
      layout: 'personal_letter',
      theme: 'cream_and_forest',
    })

    await user.click(screen.getByRole('button', { name: 'Improve with AI' }))
    await waitFor(() => expect(requests).toHaveLength(3))
    expect(requests[2]).toMatchObject({
      currentDraft: {
        subject: 'Meet your neighbor',
        headline: null,
        body: 'Hi {{first_name}}, I am running.',
      },
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
    await user.click(
      within(screen.getByTestId('email-add-block')).getByRole('button', {
        name: 'Photo',
      }),
    )
    await user.upload(
      screen.getByLabelText('Upload a photo'),
      new File(['x'], 'logo.png', { type: 'image/png' }),
    )
    await screen.findByText('Photo added.')
    expect([...posted[0]!.keys()]).toEqual(['key', 'Content-Type', 'file'])
    await user.type(screen.getByLabelText('What the photo shows'), 'My logo')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).toMatchObject({
      content: {
        blocks: [
          { type: 'paragraph', text: 'Hi there' },
          { type: 'image', url: publicUrl, alt: 'My logo' },
        ],
      },
    })
  })

  it('picks a list, says only people with email count, and saves it with consent', async () => {
    const saves = mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await fillCompose(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).toEqual({
      goal: 'Introduce myself to voters',
      content: {
        layout: 'personal_letter',
        theme: 'cream_and_forest',
        subject: 'Hello',
        blocks: [{ type: 'paragraph', text: 'Hi there' }],
      },
      consentConfirmed: false,
    })

    expect(
      await screen.findByText(
        'Select a list or create a new one. Only voters with an email address are included.',
      ),
    ).toBeInTheDocument()
    await pickList(user)
    expect(
      await screen.findByText(/Email 4,800 voters with an email address/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/This send can reach up to 1,000 people/),
    ).toBeInTheDocument()
    expect(screen.getByText('1,000 of 4,800')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await user.click(
      screen.getByLabelText(
        'These people agreed to get email from my campaign.',
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(saves).toHaveLength(2))
    expect(saves[1]).toMatchObject({
      voterFileFilterId: 1,
      consentConfirmed: true,
    })
    expect(
      await screen.findByText('When should it go out?'),
    ).toBeInTheDocument()
  })

  it('says so and stops when no one in the list has an email address', async () => {
    mockApi()
    mockLists(0)
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await fillCompose(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await pickList(user)

    expect(
      await screen.findByText(
        'No one in this list has an email address yet. Pick another list to keep going.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText(
        'These people agreed to get email from my campaign.',
      ),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('reaches review with the reply-to line and the price', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await fillCompose(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await pickList(user)
    await user.click(
      await screen.findByLabelText(
        'These people agreed to get email from my campaign.',
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByText('When should it go out?')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByText('Ready to send?')
    expect(
      await screen.findByText(/Replies go to renee@example.com/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
    expect(await screen.findByTestId('email-reach')).toHaveTextContent(
      '1,000 of 4,800',
    )
    expect(screen.getByTestId('email-price')).toHaveTextContent('Up to $10.00')
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
    await pickList(user)
    await user.click(
      await screen.findByLabelText(
        'These people agreed to get email from my campaign.',
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('When should it go out?')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Ready to send?')

    await user.click(screen.getByRole('button', { name: 'Send me a test' }))
    expect(
      await screen.findByText('Test sent to renee@example.com.'),
    ).toBeInTheDocument()
  })

  it('takes a refused test send back to the block it names', async () => {
    mockApi()
    api.mock('POST /v1/outreach/email/:id/test', {
      status: 400,
      data: {
        message:
          'Finish the email before sending it. Block 1: Keep this to one line',
      },
    })
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await fillCompose(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await pickList(user)
    await user.click(
      await screen.findByLabelText(
        'These people agreed to get email from my campaign.',
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('When should it go out?')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Ready to send?')
    await user.click(screen.getByRole('button', { name: 'Send me a test' }))
    await user.click(
      await screen.findByRole('button', { name: 'Fix the email' }),
    )

    expect(
      within(await screen.findByRole('group', { name: 'Paragraph' })).getByText(
        'Keep this to one line.',
      ),
    ).toBeInTheDocument()
  })

  it('sends the Serve surface through the office-scoped routes with constituent copy', async () => {
    api.mock('GET /v1/outreach/serve/email/sender', {
      status: 200,
      data: sender,
    })
    const saves: unknown[] = []
    api.mock('POST /v1/outreach/serve/email', ({ body }) => {
      saves.push(body)
      return { status: 200, data: draft }
    })
    mockLists(40)
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} surface={SERVE_EMAIL_SURFACE} />)

    await user.click(screen.getByText('Introduce myself to constituents'))
    await writeLetter(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(
      await screen.findByText(
        'Select a list or create a new one. Only constituents with an email address are included.',
      ),
    ).toBeInTheDocument()
    await pickList(user)
    expect(
      await screen.findByText(/Email 40 constituents with an email address/),
    ).toBeInTheDocument()
    await user.click(
      screen.getByLabelText('These people agreed to get email from my office.'),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(saves).toHaveLength(2))
    expect(saves[1]).toMatchObject({
      voterFileFilterId: 1,
      consentConfirmed: true,
    })
  })
})
