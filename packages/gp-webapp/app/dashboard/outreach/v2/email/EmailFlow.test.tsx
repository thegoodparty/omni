import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { format } from 'date-fns'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { EmailFlow } from './EmailFlow'
import { SERVE_EMAIL_SURFACE } from './emailSurface'
import { initialCompose, toContent } from './emailForm.util'

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
const mockLists = (email: number, newContactsWithEmail = 0) => {
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
      newContactsReachable: {
        sms: 0,
        robocall: 0,
        phoneBanking: 0,
        doorKnocking: 0,
        email: newContactsWithEmail,
        polls: 0,
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

const writeLetter = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText('Subject'), 'Hello')
  await user.click(screen.getByRole('textbox', { name: 'Message' }))
  await user.keyboard('Hi there')
}

// Goal, then a list, landing on the write step.
const pickAudience = async (
  user: ReturnType<typeof userEvent.setup>,
  goal = 'Introduce myself to voters',
) => {
  await user.click(screen.getByText(goal))
  await pickList(user)
  await screen.findByText(/people with an email address/)
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('What do you want to say?')
}

// Write the letter, then Next through the look step, which saves.
const writeAndLook = async (user: ReturnType<typeof userEvent.setup>) => {
  await writeLetter(user)
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('How should it look?')
  await user.click(screen.getByRole('button', { name: 'Next' }))
}

const toReview = async (user: ReturnType<typeof userEvent.setup>) => {
  await pickAudience(user)
  await writeAndLook(user)
  await screen.findByText('When should it go out?')
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('Ready to send?')
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

  it('goes goal, audience, write, then look, with the button on the look step', async () => {
    const saves = mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    expect(screen.getByText('What do you want to do?')).toBeInTheDocument()
    await pickAudience(user)
    expect(saves).toHaveLength(0)

    expect(await screen.findByLabelText('Subject')).toBeInTheDocument()
    expect(screen.getByTestId('email-ai-draft')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument()
    expect(screen.getByTestId('email-photo')).toBeInTheDocument()
    expect(screen.queryByTestId('email-button')).toBeNull()

    await writeLetter(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('How should it look?')).toBeInTheDocument()
    expect(screen.getByTestId('email-button')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Personal letter' })).toBeChecked()
    expect(screen.queryByLabelText('Subject')).toBeNull()
  })

  it('sends on payment when the time is left at as soon as it is paid', async () => {
    const saves = mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await pickAudience(user)
    await writeAndLook(user)
    await screen.findByText('When should it go out?')
    expect(screen.getByLabelText('Send date')).toHaveTextContent(
      new Date().toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    )
    expect(
      screen.getByRole('combobox', { name: 'Send time' }),
    ).toHaveTextContent("As soon as it's paid")
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Ready to send?')

    expect(saves).toHaveLength(2)
    expect(saves[1]).not.toHaveProperty('date')
    expect(screen.getByText('As soon as it is paid')).toBeInTheDocument()
  })

  it('asks for a time after a later day is picked, then schedules it', async () => {
    const saves = mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await pickAudience(user)
    await writeAndLook(user)
    await screen.findByText('When should it go out?')
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    await user.click(screen.getByLabelText('Send date'))
    if (tomorrow.getMonth() !== today.getMonth()) {
      await user.click(screen.getByRole('button', { name: /next month/i }))
    }
    await user.click(
      screen.getByRole('button', { name: format(tomorrow, 'PPPP') }),
    )

    const timeTrigger = screen.getByRole('combobox', { name: 'Send time' })
    expect(timeTrigger).toHaveTextContent('Select time')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Pick a time.')).toBeInTheDocument()
    expect(saves).toHaveLength(1)

    await user.click(timeTrigger)
    expect(
      screen.queryByRole('option', { name: "As soon as it's paid" }),
    ).toBeNull()
    expect(screen.getByRole('option', { name: '12:00 AM' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: '9:00 AM' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Ready to send?')

    expect(saves).toHaveLength(2)
    expect(saves[1]).toHaveProperty(
      'date',
      new Date(
        tomorrow.getFullYear(),
        tomorrow.getMonth(),
        tomorrow.getDate(),
        9,
      ).toISOString(),
    )
    expect(screen.queryByText('As soon as it is paid')).toBeNull()
    expect(
      screen.getByText(
        new Date(
          tomorrow.getFullYear(),
          tomorrow.getMonth(),
          tomorrow.getDate(),
          9,
        ).toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        }),
      ),
    ).toBeInTheDocument()
  })

  it('keeps the email across Back and Next between write and look', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await pickAudience(user)
    await writeLetter(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('How should it look?')
    await user.click(screen.getByRole('radio', { name: 'Long update' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByLabelText('Subject')).toHaveValue('Hello')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveTextContent(
      'Hi there',
    )
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
  })

  it('saves a short email with no title, no button and a long message', async () => {
    const saves = mockApi()
    const user = userEvent.setup({ delay: null })
    render(<EmailFlow open onClose={vi.fn()} />)

    await pickAudience(user)
    await user.type(await screen.findByLabelText('Subject'), 'Hello')
    await user.click(screen.getByRole('textbox', { name: 'Message' }))
    await user.keyboard(
      `${'a'.repeat(300)}{Enter}{Enter}${'b'.repeat(301)}{Enter}{Enter}c`,
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('How should it look?')
    await user.click(screen.getByRole('radio', { name: 'Short' }))

    expect(screen.getByText('Button (optional)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(saves).toHaveLength(1))
  })

  it('holds Next on the look step until an added button is complete', async () => {
    const saves = mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await pickAudience(user)
    await writeLetter(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('How should it look?')
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Add a button' }))
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await user.type(screen.getByLabelText('Button text'), 'Sign up')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByTestId('email-link-prompt')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Button link'), 'example.org')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByTestId('email-button')).toHaveTextContent(/https:\/\//)

    await user.clear(screen.getByLabelText('Button link'))
    await user.type(screen.getByLabelText('Button link'), 'https://example.org')
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(saves).toHaveLength(1))
  })

  it('lets Next through again once a half-filled button is removed', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await pickAudience(user)
    await writeLetter(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('How should it look?')
    await user.click(screen.getByRole('button', { name: 'Add a button' }))
    await user.type(screen.getByLabelText('Button text'), 'Sign up')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Remove button' }))
    expect(screen.queryByLabelText('Button text')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('holds the write step until the subject and message are written', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await pickAudience(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Add a subject line.')).toBeInTheDocument()
    expect(screen.queryByText('How should it look?')).toBeNull()
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

    await pickAudience(user)
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

    await pickAudience(user)

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

    await pickAudience(user)
    await user.upload(
      screen.getByLabelText('Photo (optional)'),
      new File(['x'], 'logo.png', { type: 'image/png' }),
    )
    await screen.findByText('Photo added.')
    expect([...posted[0]!.keys()]).toEqual(['key', 'Content-Type', 'file'])

    await writeAndLook(user)
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).toMatchObject({
      content: {
        blocks: [
          { type: 'image', url: publicUrl, alt: '' },
          { type: 'paragraph', text: 'Hi there' },
        ],
      },
    })
  })

  it('picks a list, says only imported people with email count, and saves it', async () => {
    const saves = mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await user.click(screen.getByText('Introduce myself to voters'))
    expect(
      await screen.findByText(
        /Only people you imported with an email address can get email\./,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Import contacts' }),
    ).toHaveAttribute('href', '/dashboard/contacts?import=1')
    await pickList(user)
    expect(
      await screen.findByText('4,800 people with an email address'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/This send can reach up to 1,000 people/),
    ).toBeInTheDocument()
    expect(screen.getByText('1,000 of 4,800')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('What do you want to say?')
    expect(saves).toHaveLength(0)

    await writeAndLook(user)
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).toEqual({
      goal: 'Introduce myself to voters',
      content: {
        layout: 'personal_letter',
        theme: 'cream_and_forest',
        subject: 'Hello',
        blocks: [{ type: 'paragraph', text: 'Hi there' }],
      },
      voterFileFilterId: 1,
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

    await user.click(screen.getByText('Introduce myself to voters'))
    await pickList(user)

    expect(
      await screen.findByText(
        'No one in this list has an email address yet. Pick another list to keep going.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('counts imported new contacts in one plain email count', async () => {
    mockApi()
    mockLists(10, 10)
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await user.click(screen.getByText('Introduce myself to voters'))
    await pickList(user)

    expect(
      await screen.findByText('10 people with an email address'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/new contacts/)).not.toBeInTheDocument()
  })

  it('reaches review with the reply-to line and the price', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} />)

    await toReview(user)
    expect(
      await screen.findByText(/Replies go to renee@example.com/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
    expect(await screen.findByTestId('email-reach')).toHaveTextContent(
      '1,000 of 4,800',
    )
    expect(screen.getByTestId('email-price')).toHaveTextContent('Up to $10.00')
    expect(
      screen
        .getByTestId('email-reach')
        .compareDocumentPosition(screen.getByTestId('email-preview')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
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

    await toReview(user)

    await user.click(screen.getByRole('button', { name: 'Send me a test' }))
    expect(
      await screen.findByText('Test sent to renee@example.com.'),
    ).toBeInTheDocument()
  })

  it('takes a refused test send back to the field it names', async () => {
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

    await toReview(user)
    await user.click(screen.getByRole('button', { name: 'Send me a test' }))
    await user.click(
      await screen.findByRole('button', { name: 'Fix the email' }),
    )

    expect(
      await screen.findByText('Keep this to one line.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
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

    expect(
      await screen.findByText(
        /Only people you imported with an email address can get email\./,
      ),
    ).toBeInTheDocument()
    await pickList(user)
    expect(
      await screen.findByText('40 people with an email address'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await writeAndLook(user)
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).toMatchObject({ voterFileFilterId: 1 })
    expect(saves[0]).not.toHaveProperty('consentConfirmed')
  })
})

// A reopened draft: every save replaces the whole draft, so anything the flow
// doesn't load back would be erased by the next save.
describe('EmailFlow reopening a draft', () => {
  afterEach(() => vi.restoreAllMocks())

  const tomorrowAt3 = () => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(15, 0, 0, 0)
    return d.toISOString()
  }
  const content = toContent({
    ...initialCompose(),
    layout: 'short_cta',
    theme: 'classic_blue',
    subject: 'Meet me Saturday',
    title: 'Town hall',
    message: 'Hi {{first_name}},\n\n## Where\n\nThe library, at noon.',
    photoUrl: 'https://cdn.example.com/a.png',
    buttonLabel: 'RSVP',
    buttonUrl: 'https://example.com/rsvp',
  })
  const fullDraft = (date: string | null, listId: number) => ({
    ...sendShape,
    id: 42,
    goal: 'Introduce myself to voters',
    date,
    voterFileFilterId: listId,
    content,
  })

  it('loads every step, opens on review, and saves back what it loaded', async () => {
    const saves = mockApi()
    const date = tomorrowAt3()
    const user = userEvent.setup()
    render(<EmailFlow open onClose={vi.fn()} draft={fullDraft(date, 1)} />)

    expect(await screen.findByText('Ready to send?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByText('When should it go out?')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Ready to send?')

    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).toEqual({
      id: 42,
      goal: 'Introduce myself to voters',
      content,
      date,
      voterFileFilterId: 1,
    })
  })

  it('shows a saved button on the look step', async () => {
    mockApi()
    const user = userEvent.setup()
    render(
      <EmailFlow open onClose={vi.fn()} draft={fullDraft(tomorrowAt3(), 1)} />,
    )

    await screen.findByText('Ready to send?')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByText('When should it go out?')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByText('How should it look?')
    expect(screen.getByDisplayValue('RSVP')).toBeInTheDocument()
    expect(
      screen.getByDisplayValue('https://example.com/rsvp'),
    ).toBeInTheDocument()
  })

  it('opens on the audience step when the list is gone', async () => {
    mockApi()
    render(
      <EmailFlow open onClose={vi.fn()} draft={fullDraft(tomorrowAt3(), 99)} />,
    )

    expect(
      await screen.findByText(/Choose a (voter|constituent) list/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Ready to send?')).not.toBeInTheDocument()
  })

  it('opens on the schedule step, sending once paid, when the time has passed', async () => {
    const saves = mockApi()
    const user = userEvent.setup()
    render(
      <EmailFlow
        open
        onClose={vi.fn()}
        draft={fullDraft('2020-01-01T15:00:00.000Z', 1)}
      />,
    )

    expect(
      await screen.findByText('When should it go out?'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).not.toHaveProperty('date')
  })
})
